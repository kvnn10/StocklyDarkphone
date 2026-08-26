"use client";

import { useEffect } from "react";

// Phrase-level replacements catch fixed English UI copy embedded in longer nodes.
// Keep replacements specific: short fragments such as "To" must never be
// replaced globally because they can corrupt words like "Total".
const PHRASES: Array<[string, string]> = [
  ["Store Analytics & Dashboard", "Análisis y panel de la tienda"],
  ["Overview, statistics, trends, and AI-powered insights", "Resumen, estadísticas, tendencias y análisis con IA"],
  ["Store-wide metrics", "Métricas de toda la tienda"],
  ["Total Products", "Total de productos"],
  ["Products availability", "Disponibilidad de productos"],
  ["Total Value", "Valor total"],
  ["Total inventory value", "Valor total del inventario"],
  ["Total Revenue", "Ingresos totales"],
  ["Profits (excl. cancelled)", "Ingresos (sin cancelados)"],
  ["Total Orders", "Total de pedidos"],
  ["Total orders placed (self + client)", "Total de pedidos realizados (propios y de clientes)"],
  ["Total Users", "Total de usuarios"],
  ["Registered users", "Usuarios registrados"],
  ["Total Suppliers", "Total de proveedores"],
  ["Storage locations", "Ubicaciones de almacenamiento"],
  ["Total invoices (store-wide)", "Total de facturas (toda la tienda)"],
  ["Product categories", "Categorías de productos"],
  ["Support Tickets", "Tickets de soporte"],
  ["Product reviews", "Reseñas de productos"],
  ["Average Order Value", "Valor promedio del pedido"],
  ["Per order (store-wide)", "Por pedido (toda la tienda)"],
  ["Paid revenue", "Ingresos cobrados"],
  ["Pending payments", "Pagos pendientes"],
  ["Total Order Revenue", "Ingresos totales de pedidos"],
  ["Orders & revenue over time", "Pedidos e ingresos a lo largo del tiempo"],
  ["Revenue = order totals (excl. cancelled).", "Ingresos = totales de pedidos (sin cancelados)."],
  ["New products & invoices", "Nuevos productos y facturas"],
  ["Order Analytics", "Análisis de pedidos"],
  ["Invoice Analytics", "Análisis de facturas"],
  ["Invoice Status Distribution", "Distribución del estado de facturas"],
  ["Order Status Distribution", "Distribución del estado de pedidos"],
  ["Warehouse Analytics", "Análisis de almacenes"],
  ["Warehouses by Type", "Almacenes por tipo"],
  ["Recent Orders", "Pedidos recientes"],
  ["Recent Imports", "Importaciones recientes"],
  ["No imports yet", "Aún no hay importaciones"],
  ["View All Imports", "Ver todas las importaciones"],
  ["Completed Orders", "Pedidos completados"],
  ["Avg invoice value", "Valor promedio de factura"],
  ["Per invoice (excl. cancelled)", "Por factura (sin canceladas)"],
  ["Total warehouses", "Total de almacenes"],
  ["All locations", "Todas las ubicaciones"],
  ["Reviews", "Reseñas"],
  ["Approved", "Aprobadas"],
  ["Rejected", "Rechazadas"],
  ["AI-powered insights", "Análisis con IA"],
  ["Generate insights", "Generar análisis"],
  ["AI insights not configured", "Análisis con IA no configurado"],
  ["Set OPENROUTER_API_KEY and/or GROQ_API_KEY in .env to enable AI-powered insights.", "Configura OPENROUTER_API_KEY y/o GROQ_API_KEY en el entorno para habilitar los análisis con IA."],
  ["AI insights generated", "Análisis con IA generado"],
  ["Recommendations are ready.", "Las recomendaciones están listas."],
  ["Failed to generate insights", "No se pudieron generar los análisis"],
  ["Network error. Please try again.", "Error de red. Inténtalo nuevamente."],
  ["Demand Forecasting & Predictions", "Pronóstico y predicciones de demanda"],
  ["Category Demand Forecast", "Pronóstico de demanda por categoría"],
  ["Seasonal Demand Trends", "Tendencias estacionales de la demanda"],
  ["All Product Forecasts", "Pronóstico de todos los productos"],
  ["Critical stock level", "Nivel de stock crítico"],
  ["PRODUCTS ANALYZED", "PRODUCTOS ANALIZADOS"],
  ["AT RISK OF STOCKOUT", "EN RIESGO DE AGOTARSE"],
  ["ANOMALIES DETECTED", "ANOMALÍAS DETECTADAS"],
  ["Store-wide", "Toda la tienda"],
  ["Current", "Actual"],
  ["Predicted", "Previsto"],
  ["Generate Report", "Generar informe"],
  ["View Details", "Ver detalles"],
  ["Total inventory", "Inventario total"],
  ["Inventory value", "Valor del inventario"],
  ["Business Insights", "Análisis del negocio"],
  ["Business insights", "Análisis del negocio"],
  ["Administration", "Administración"],
  ["Admin Dashboard", "Panel de administración"],
  ["Dashboard", "Panel"],
  ["System Settings", "Configuración del sistema"],
  ["User Management", "Gestión de usuarios"],
  ["Create User", "Crear usuario"],
  ["Edit User", "Editar usuario"],
  ["Delete User", "Eliminar usuario"],
  ["User Details", "Detalles del usuario"],
  ["User Profile", "Perfil del usuario"],
  ["Manage users and roles", "Gestiona usuarios y roles"],
  ["Search by name, email, or username", "Buscar por nombre, correo o nombre de usuario"],
  ["Filter by role", "Filtrar por rol"],
  ["All Roles", "Todos los roles"],
  ["No users found", "No se encontraron usuarios"],
  ["Sort by", "Ordenar por"],
  ["Last active", "Última actividad"],
  ["Last login", "Último acceso"],
  ["Change Role", "Cambiar rol"],
  ["Clear Filters", "Limpiar filtros"],
  ["Loading...", "Cargando..."],
  ["No data available", "No hay datos disponibles"],
  ["No results found", "No se encontraron resultados"],
  ["Something went wrong", "Algo salió mal"],
  ["Try again", "Intentar de nuevo"],
  ["First Name", "Nombre"],
  ["Last Name", "Apellido"],
  ["Email", "Correo electrónico"],
  ["Username", "Nombre de usuario"],
  ["Password", "Contraseña"],
  ["Confirm Password", "Confirmar contraseña"],
  ["Save Changes", "Guardar cambios"],
  ["Cancel", "Cancelar"],
  ["Delete", "Eliminar"],
  ["Edit", "Editar"],
  ["Create", "Crear"],
  ["Search", "Buscar"],
  ["Actions", "Acciones"],
  ["View Detail", "Ver detalle"],
  ["Products availability", "Disponibilidad de productos"],
  ["Available", "Disponibles"],
  ["Stock low", "Stock bajo"],
  ["Stock out", "Sin stock"],
  ["Orders", "Pedidos"],
  ["Invoices", "Facturas"],
  ["Due", "Pendiente"],
  ["Cancelled", "Cancelado"],
  ["Paid", "Pagado"],
  ["Partial", "Parcial"],
  ["Refund", "Reembolso"],
  ["Pending", "Pendiente"],
  ["Active", "Activos"],
  ["Inactive", "Inactivos"],
  ["Open", "Abiertos"],
  ["In progress", "En progreso"],
  ["Resolved", "Resueltos"],
  ["Closed", "Cerrados"],
  ["Latest 5", "Últimos 5"],
  ["Self", "Propios"],
  ["Client", "Clientes"],
  ["Supplier", "Proveedores"],
  ["Other users", "Otros usuarios"],
  ["Other", "Otros"],
  ["Store-wide.", "Toda la tienda."],
  ["Store-wide", "Toda la tienda"],
  ["Revenue", "Ingresos"],
  ["Collected", "Cobrado"],
  ["Paid revenue: ", "Ingresos cobrados: "],
  ["Pending payments: ", "Pagos pendientes: "],
  ["Past due date", "Después de la fecha de vencimiento"],
  ["Amount", "Monto"],
  ["Paid:", "Pagado:"],
  ["Cancelled:", "Cancelado:"],
  ["Draft", "Borrador"],
  ["Sent", "Enviadas"],
  ["Overdue", "Vencidas"],
  ["Revenue = sum of order line subtotals.", "Ingresos = suma de los subtotales de las líneas de pedido."],
  ["Lines", "Líneas"],
  ["Qty", "Cant."],
  ["Insights", "Análisis"],
  ["Recommendations", "Recomendaciones"],
  ["Date range", "Rango de fechas"],
  ["From", "Desde"],
  ["To:", "Hasta:"],
  ["Export Analytics", "Exportar análisis"],
  ["Export", "Exportar"],
];

function translate(raw: string): string {
  let result = raw;
  for (const [source, target] of PHRASES) {
    if (result === source) {
      result = target;
      continue;
    }

    // Only replace a phrase inside a larger text node when it is long enough
    // to avoid corrupting Spanish words that contain an English key as a prefix
    // (e.g. "Cancelar" must never become "Cancelarar").
    if (source.length >= 8 && result.includes(source)) {
      result = result.split(source).join(target);
    }
  }
  return result;
}

function scan(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }
  for (const text of nodes) {
    const raw = text.nodeValue ?? "";
    if (!raw.trim()) continue;
    const next = translate(raw);
    if (next !== raw) text.nodeValue = next;
  }
  if (root instanceof Element) {
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
      for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
        const value = element.getAttribute(attr);
        if (!value) continue;
        const next = translate(value);
        if (next !== value) element.setAttribute(attr, next);
      }
    }
  }
}

export function SpanishPhraseProvider() {
  useEffect(() => {
    scan(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const added of Array.from(mutation.addedNodes)) {
          if (added.nodeType === Node.ELEMENT_NODE) scan(added as Element);
          if (added.nodeType === Node.TEXT_NODE) {
            const raw = added.nodeValue ?? "";
            const next = translate(raw);
            if (next !== raw) added.nodeValue = next;
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
