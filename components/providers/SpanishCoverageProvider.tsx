"use client";

import { useEffect } from "react";

/**
 * Second-pass Spanish coverage for legacy dashboard/admin copy.
 * This complements SpanishUiProvider without touching business/data values.
 */
const COVERAGE: Record<string, string> = {
  "Category Demand Forecast": "Pronóstico de demanda por categoría",
  "60% confidence": "60% de confianza",
  "85% confidence": "85% de confianza",
  Current: "Actual",
  Predicted: "Previsto",
  "Seasonal Demand Trends": "Tendencias estacionales de la demanda",
  "Generate Report": "Generar informe",
  "View Details": "Ver detalles",
  "AI-powered insights": "Análisis con IA",
  "Generate insights": "Generar análisis",
  "Click \"Generate insights\" to get AI recommendations from your dashboard data.": "Haz clic en «Generar análisis» para obtener recomendaciones de IA a partir de los datos de tu panel.",
  "AI insights require OPENROUTER_API_KEY and/or GROQ_API_KEY. Set in .env to enable.": "El análisis con IA requiere OPENROUTER_API_KEY y/o GROQ_API_KEY. Configúralas en el entorno para habilitar esta función.",
  "AI insights not configured": "Análisis con IA no configurado",
  "Set OPENROUTER_API_KEY and/or GROQ_API_KEY in .env to enable AI-powered insights.": "Configura OPENROUTER_API_KEY y/o GROQ_API_KEY en el entorno para habilitar los análisis con IA.",
  "Demand Forecasting & Predictions": "Pronóstico y predicciones de demanda",
  "Store-wide": "Toda la tienda",
  "PRODUCTS ANALYZED": "PRODUCTOS ANALIZADOS",
  "AT RISK OF STOCKOUT": "EN RIESGO DE AGOTARSE",
  OVERSTOCKED: "SOBRESTOCK",
  "ANOMALIES DETECTED": "ANOMALÍAS DETECTADAS",
  "All Product Forecasts": "Pronóstico de todos los productos",
  "Demand predictions and stock levels for all products (sorted by urgency)": "Predicciones de demanda y niveles de stock de todos los productos (ordenados por urgencia)",
  "Critical stock level": "Nivel de stock crítico",
  High: "Alto",
  "Recent Imports": "Importaciones recientes",
  "Latest 5": "Últimas 5",
  "No imports yet": "Aún no hay importaciones",
  "View All Imports": "Ver todas las importaciones",
  "Recent Orders": "Pedidos recientes",
  "Overdue": "Vencidas",
  "Past due date": "Después de la fecha de vencimiento",
  Amount: "Importe",
  "Paid revenue": "Ingresos cobrados",
  "Collected": "Cobrado",
  "Invoices": "Facturas",
  "Excl. cancelled": "Sin canceladas",
  "Total (excl.)": "Total (sin canceladas)",
  "Invoice Status Distribution": "Distribución del estado de facturas",
  Draft: "Borrador",
  Sent: "Enviadas",
  "Order Status Distribution": "Distribución del estado de pedidos",
  Processing: "Procesando",
  Shipped: "Enviados",
  "Completed Orders": "Pedidos completados",
  "Orders & revenue over time": "Pedidos e ingresos a lo largo del tiempo",
  "Last 12 months": "Últimos 12 meses",
  "Revenue = order totals (excl. cancelled).": "Ingresos = totales de pedidos (sin cancelados).",
  "New products & invoices": "Nuevos productos y facturas",
  "Order Analytics": "Análisis de pedidos",
  "Invoice Analytics": "Análisis de facturas",
  "Avg invoice value": "Valor promedio de factura",
  "Per invoice (excl. cancelled)": "Por factura (sin canceladas)",
  "Paid Revenue": "Ingresos cobrados",
  "Total Order Revenue": "Ingresos totales de pedidos",
  "Ingresos (sin pedidos cancelados)": "Ingresos (sin pedidos cancelados)",
  "Pending payment": "Pendientes de pago",
  "Pending payments": "Pagos pendientes",
  "Refunded": "Reembolsados",
  "Completed": "Completados",
  "Order revenue": "Ingresos de pedidos",
  "Products by Orders": "Productos por pedidos",
  "Top 5 Products by Orders": "Top 5 de productos por pedidos",
  "Lines": "Líneas",
  Qty: "Cant.",
  "Revenue = sum of order line subtotals.": "Ingresos = suma de los subtotales de las líneas de pedido.",
  "Warehouse Analytics": "Análisis de almacenes",
  "Warehouses by Type": "Almacenes por tipo",
  "Total warehouses": "Total de almacenes",
  "All locations": "Todas las ubicaciones",
  "Active: 0": "Activos: 0",
  "Inactive: 0": "Inactivos: 0",
  "Top 5": "Top 5",
  Reviews: "Reseñas",
  "Product reviews": "Reseñas de productos",
  Approved: "Aprobadas",
  Rejected: "Rechazadas",
  "Average Order Value": "Valor promedio del pedido",
  "Per order (store-wide)": "Por pedido (toda la tienda)",
  "Orders & revenue": "Pedidos e ingresos",
  "Order revenue (excl. cancelled)": "Ingresos de pedidos (sin cancelados)",
  "Order Analytics & Dashboard": "Análisis y panel de pedidos",
  "Business Insights": "Análisis del negocio",
  "Business insights": "Análisis del negocio",
  "Overview, statistics, trends, and AI-powered insights across products, users, suppliers, categories, orders, invoices, warehouses, tickets, and reviews. Store-wide metrics.": "Resumen, estadísticas, tendencias y análisis con IA de productos, usuarios, proveedores, categorías, pedidos, facturas, almacenes, tickets y reseñas. Métricas de toda la tienda.",
  "Total Products": "Total de productos",
  "Products availability": "Disponibilidad de productos",
  "Total Value": "Valor total",
  "Total inventory value": "Valor total del inventario",
  "Total Revenue": "Ingresos totales",
  "Profits (excl. cancelled)": "Ingresos (sin cancelados)",
  "Total Orders": "Total de pedidos",
  "Total orders placed (self + client)": "Total de pedidos realizados (propios y de clientes)",
  "Total Users": "Total de usuarios",
  "Registered users": "Usuarios registrados",
  "Total Suppliers": "Total de proveedores",
  "Suppliers": "Proveedores",
  "Storage locations": "Ubicaciones de almacenamiento",
  "Total invoices (store-wide)": "Total de facturas (toda la tienda)",
  "Categories": "Categorías",
  "Product categories": "Categorías de productos",
  "Tickets": "Tickets",
  "Open": "Abiertos",
  "In progress": "En progreso",
  "Resolved": "Resueltos",
  "Closed": "Cerrados",
  "Pending": "Pendientes",
  "Average Price": "Precio promedio",
  "Total Quantity": "Cantidad total",
  "Stock Utilization": "Utilización del stock",
  "Inventory Health": "Estado del inventario",
  "Stock Coverage": "Cobertura de stock",
  "Value Density": "Densidad de valor",
  "Quick Insights": "Información rápida",
  "Store Overview": "Resumen de la tienda",
  "Quick Access": "Acceso rápido",
  "View All": "Ver todo",
  "View All Products": "Ver todos los productos",
  "View All Orders": "Ver todos los pedidos",
  "View All Invoices": "Ver todas las facturas",
  "View All Warehouses": "Ver todos los almacenes",
  "View All Suppliers": "Ver todos los proveedores",
  "Administration": "Administración",
  "Admin Dashboard": "Panel de administración",
  "Dashboard": "Panel",
  "Settings": "Configuración",
  "System Settings": "Configuración del sistema",
  "Product & System Management": "Gestión de productos y sistema",
  "Personal activity": "Actividad personal",
  "My Activity": "Mi actividad",
  "Email Preferences": "Preferencias de correo",
  "Activity History": "Historial de actividad",
  "User Management": "Gestión de usuarios",
  "Manage users and roles. View and update name, role, and profile.": "Gestiona usuarios y roles. Consulta y actualiza el nombre, rol y perfil.",
  "Create User": "Crear usuario",
  "Create user": "Crear usuario",
  "Edit User": "Editar usuario",
  "Delete User": "Eliminar usuario",
  "User Details": "Detalles del usuario",
  "User Profile": "Perfil del usuario",
  "First Name": "Nombre",
  "Last Name": "Apellido",
  "Email": "Correo electrónico",
  Username: "Nombre de usuario",
  Password: "Contraseña",
  "Confirm Password": "Confirmar contraseña",
  "Save Changes": "Guardar cambios",
  Save: "Guardar",
  Cancel: "Cancelar",
  Delete: "Eliminar",
  Edit: "Editar",
  Create: "Crear",
  Search: "Buscar",
  "Search users...": "Buscar usuarios...",
  "Search by name, email, or username...": "Buscar por nombre, correo o nombre de usuario...",
  "Filter by role...": "Filtrar por rol...",
  "All Roles": "Todos los roles",
  "No users found": "No se encontraron usuarios",
  "No users found.": "No se encontraron usuarios.",
  "Role": "Rol",
  "Joined": "Registro",
  "Last active": "Última actividad",
  "Last login": "Último acceso",
  "Actions": "Acciones",
  "View": "Ver",
  "View Detail": "Ver detalle",
  "Change Role": "Cambiar rol",
  "Administrator": "Administrador",
  "Supplier": "Proveedor",
  "Client": "Cliente",
  "Retailer": "Minorista",
  "No role found.": "No se encontró ningún rol.",
  "Clear Filters": "Limpiar filtros",
  "Sort by": "Ordenar por",
  Asc: "Ascendente",
  Desc: "Descendente",
  "Loading...": "Cargando...",
  "Please wait...": "Por favor espera...",
  "No data available": "No hay datos disponibles",
  "No data available.": "No hay datos disponibles.",
  "No results found": "No se encontraron resultados",
  "No results found.": "No se encontraron resultados.",
  "Failed to load": "No se pudo cargar",
  "Something went wrong": "Algo salió mal",
  "Try again": "Intentar de nuevo",
  Retry: "Reintentar",
  "Error": "Error",
  "Success": "Éxito",
};

function translate(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  let node = walker.nextNode();
  while (node) {
    nodes.push(node as Text);
    node = walker.nextNode();
  }

  for (const textNode of nodes) {
    const raw = textNode.nodeValue ?? "";
    const trimmed = raw.trim();
    const translated = COVERAGE[trimmed];
    if (!translated || translated === trimmed) continue;
    const start = raw.indexOf(trimmed);
    textNode.nodeValue = `${raw.slice(0, start)}${translated}${raw.slice(start + trimmed.length)}`;
  }

  if (root instanceof Element) {
    for (const element of [root, ...Array.from(root.querySelectorAll("*"))]) {
      for (const attr of ["placeholder", "aria-label", "title", "alt"]) {
        const value = element.getAttribute(attr);
        const translated = value ? COVERAGE[value.trim()] : undefined;
        if (translated && translated !== value) element.setAttribute(attr, translated);
      }
    }
  }
}

export function SpanishCoverageProvider() {
  useEffect(() => {
    translate(document.body);
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const added of Array.from(mutation.addedNodes)) {
          if (added.nodeType === Node.ELEMENT_NODE) translate(added as Element);
          else if (added.nodeType === Node.TEXT_NODE) {
            const text = added.nodeValue?.trim() ?? "";
            if (COVERAGE[text]) added.nodeValue = COVERAGE[text];
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
