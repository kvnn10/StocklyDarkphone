/**
 * Health Check API Route
 * Provides comprehensive system health monitoring including:
 * - Database connection status
 * - External API health (ImageKit, Brevo, Redis)
 * - Uptime tracking
 * - Performance metrics
 */

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/prisma/client";
import { getRedis, isRedisConfigured } from "@/lib/cache/redis";
import { isBrevoConfigured } from "@/lib/email/brevo";
import { logger } from "@/lib/logger";
import { successResponse, errorResponse } from "@/lib/api/response-helpers";
import { trackDatabaseQuery } from "@/lib/monitoring/system-metrics";

async function checkDatabaseHealth(): Promise<{
  status: "OK" | "ERROR";
  responseTime: number;
  message: string;
}> {
  const startTime = Date.now();
  try {
    await prisma.user.count();
    const responseTime = Date.now() - startTime;
    trackDatabaseQuery(responseTime).catch(() => {});

    return {
      status: "OK",
      responseTime,
      message: "Database connection healthy",
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error("Database health check failed", { error });
    trackDatabaseQuery(responseTime).catch(() => {});

    // Never expose provider/connection details from a public health endpoint.
    return {
      status: "ERROR",
      responseTime,
      message: "Database connection unavailable",
    };
  }
}

async function checkRedisHealth(): Promise<{
  status: "OK" | "ERROR" | "NOT_CONFIGURED";
  responseTime: number;
  message: string;
}> {
  const startTime = Date.now();

  if (!isRedisConfigured()) {
    return {
      status: "NOT_CONFIGURED",
      responseTime: 0,
      message: "Redis not configured",
    };
  }

  try {
    const redis = getRedis();
    if (!redis) {
      return {
        status: "ERROR",
        responseTime: Date.now() - startTime,
        message: "Redis client unavailable",
      };
    }

    await redis.ping();
    return {
      status: "OK",
      responseTime: Date.now() - startTime,
      message: "Redis connection healthy",
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error("Redis health check failed", { error });
    return {
      status: "ERROR",
      responseTime,
      message: "Redis connection unavailable",
    };
  }
}

async function checkImageKitHealth(): Promise<{
  status: "OK" | "ERROR" | "NOT_CONFIGURED";
  responseTime: number;
  message: string;
}> {
  const startTime = Date.now();
  const publicKey = process.env.NEXT_PUBLIC_IMAGEKIT_PUBLIC_KEY;
  const privateKey = process.env.IMAGEKIT_PRIVATE_KEY;
  const urlEndpoint = process.env.NEXT_PUBLIC_IMAGEKIT_URL_ENDPOINT;

  if (!publicKey || !privateKey || !urlEndpoint) {
    return {
      status: "NOT_CONFIGURED",
      responseTime: 0,
      message: "ImageKit not configured",
    };
  }

  try {
    const response = await fetch("https://api.imagekit.io/v1/files", {
      method: "GET",
      headers: {
        Authorization: `Basic ${Buffer.from(`${privateKey}:`).toString("base64")}`,
      },
      signal: AbortSignal.timeout(5000),
    });
    const responseTime = Date.now() - startTime;

    if (response.status === 200 || response.status === 401) {
      return {
        status: "OK",
        responseTime,
        message: "ImageKit service accessible",
      };
    }

    return {
      status: "ERROR",
      responseTime,
      message: "ImageKit service unavailable",
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error("ImageKit health check failed", { error });
    return {
      status: "ERROR",
      responseTime,
      message: "ImageKit service unavailable",
    };
  }
}

async function checkBrevoHealth(): Promise<{
  status: "OK" | "ERROR" | "NOT_CONFIGURED";
  responseTime: number;
  message: string;
}> {
  const startTime = Date.now();

  if (!isBrevoConfigured()) {
    return {
      status: "NOT_CONFIGURED",
      responseTime: 0,
      message: "Brevo not configured",
    };
  }

  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return {
        status: "NOT_CONFIGURED",
        responseTime: 0,
        message: "Brevo API key not configured",
      };
    }

    const response = await fetch("https://api.brevo.com/v3/account", {
      method: "GET",
      headers: { "api-key": apiKey },
      signal: AbortSignal.timeout(5000),
    });
    const responseTime = Date.now() - startTime;

    if (response.status === 200 || response.status === 401) {
      return {
        status: "OK",
        responseTime,
        message: "Brevo service accessible",
      };
    }

    return {
      status: "ERROR",
      responseTime,
      message: "Brevo service unavailable",
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.error("Brevo health check failed", { error });
    return {
      status: "ERROR",
      responseTime,
      message: "Brevo service unavailable",
    };
  }
}

async function getUptime(): Promise<{ uptime: string; startTime: string | null }> {
  try {
    if (isRedisConfigured()) {
      const redis = getRedis();
      if (redis) {
        const startTimeStr = await redis.get("app:start_time");
        if (startTimeStr && typeof startTimeStr === "string") {
          const startTime = new Date(startTimeStr);
          const diff = Date.now() - startTime.getTime();
          const hours = Math.floor(diff / (1000 * 60 * 60));
          const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
          const seconds = Math.floor((diff % (1000 * 60)) / 1000);
          return {
            uptime: `${hours}h ${minutes}m ${seconds}s`,
            startTime: startTimeStr,
          };
        }
      }
    }

    const uptimeSeconds = Math.floor(process.uptime());
    const hours = Math.floor(uptimeSeconds / 3600);
    const minutes = Math.floor((uptimeSeconds % 3600) / 60);
    const seconds = uptimeSeconds % 60;
    return {
      uptime: `${hours}h ${minutes}m ${seconds}s`,
      startTime: null,
    };
  } catch (error) {
    logger.error("Failed to get uptime", { error });
    return { uptime: "Unknown", startTime: null };
  }
}

async function initializeUptimeTracking(): Promise<void> {
  try {
    if (isRedisConfigured()) {
      const redis = getRedis();
      if (redis && !(await redis.exists("app:start_time"))) {
        await redis.set("app:start_time", new Date().toISOString());
      }
    }
  } catch (error) {
    logger.error("Failed to initialize uptime tracking", { error });
  }
}

export async function GET(_request: NextRequest) {
  try {
    await initializeUptimeTracking();

    const [database, redis, imagekit, brevo, uptime] = await Promise.all([
      checkDatabaseHealth(),
      checkRedisHealth(),
      checkImageKitHealth(),
      checkBrevoHealth(),
      getUptime(),
    ]);

    const criticalHealthy = database.status === "OK";
    const optionalServices = [redis, imagekit, brevo];
    const optionalHealthy = optionalServices.filter(
      (service) => service.status === "OK" || service.status === "NOT_CONFIGURED"
    ).length;

    const overallHealth = criticalHealthy
      ? optionalHealthy === optionalServices.length
        ? "HEALTHY"
        : "DEGRADED"
      : "DOWN";

    return successResponse({
      status: overallHealth,
      timestamp: new Date().toISOString(),
      uptime: uptime.uptime,
      services: {
        database,
        redis,
        imagekit,
        brevo,
      },
      environment: process.env.NODE_ENV || "development",
    });
  } catch (error) {
    logger.error("Health check failed", { error });
    return errorResponse("Health check unavailable", 500);
  }
}
