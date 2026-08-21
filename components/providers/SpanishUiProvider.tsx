"use client";

import { useEffect } from "react";

/**
 * Stockly currently contains a mixture of Spanish and English UI copy.
 * This small client-side layer keeps the existing business logic untouched while
 * we progressively migrate individual modules to native Spanish copy.
 *
 * Only exact UI phrases and common UI attributes are translated; user/product
 * data is intentionally left untouched.
 */
const TRANSLATIONS: Record<string, string> = {
  "Product Inventory Business Insights": "Análisis del inventario y del negocio",
  "Analyze your product inventory performance and get insights to improve your business as product owner.": "Analiza el rendimiento de tu inventario y obtén información para mejorar la gestión de tu negocio.",
  "Export Analytics": "Exportar análisis",
  "Filter by Date:": "Filtrar por fecha:",
  "From:": "Desde:",
  "To:": "Hasta:",
  Clear: "Limpiar",
  "Total Products": "Total de productos",
  "Products in inventory": "Productos en inventario",
  "Total Value": "Valor total",
  "Total inventory value": "Valor total del inventario",
  "Low Stock Items": "Productos con stock bajo",
  "Items with quantity <= 20": "Productos con 20 unidades o menos",
  "Out of Stock": "Agotados",
  "Items with zero quantity": "Productos sin existencias",
  Overview: "Resumen",
  Distribution: "Distribución",
  Trends: "Tendencias",
  Warehouses: "Almacenes",
  Alerts: "Alertas",
  "Category Distribution": "Distribución por categoría",
  "Product Growth Trend (Full Year)": "Tendencia de crecimiento de productos (año completo)",
  "Sales / Order Value Trend": "Tendencia del valor de ventas / pedidos",
  Revenue: "Ingresos",
  "Order Count by Month": "Cantidad de pedidos por mes",
  "Status Distribution": "Distribución por estado",
  "Price Range Distribution": "Distribución por rango de precio",
  "Category by Value": "Categorías por valor",
  "Supplier Performance": "Rendimiento por proveedor",
  "Top Products by Value": "Productos con mayor valor",
  "Monthly Product Addition": "Productos agregados por mes",
  "Low Stock Alerts": "Alertas de stock bajo",
  "No low stock alerts at the moment!": "No hay alertas de stock bajo en este momento.",
  "No out of stock products!": "No hay productos agotados.",
  "Quick Insights": "Información rápida",
  "Average Price": "Precio promedio",
  "Total Quantity": "Cantidad total",
  "Stock Utilization": "Utilización del stock",
  Performance: "Rendimiento",
  "Inventory Health": "Estado del inventario",
  "Stock Coverage": "Cobertura de stock",
  "Value Density": "Densidad de valor",
  "Quick QR Code": "Código QR rápido",
  "Dashboard QR": "QR del panel",
  "AI Insights": "Análisis con IA",
  "Get short AI recommendations based on your current metrics.": "Obtén recomendaciones breves de IA basadas en tus métricas actuales.",
  "Generate AI insights": "Generar análisis con IA",
  "Generating insights…": "Generando análisis…",
  Regenerate: "Regenerar",
  "AI insights generated": "Análisis de IA generado",
  "Recommendations are ready.": "Las recomendaciones están listas.",
  "Failed to generate insights": "No se pudieron generar los análisis",
  "Network error. Please try again.": "Error de red. Inténtalo nuevamente.",
  "No Data to Export": "No hay datos para exportar",
  "There is no analytics data to export.": "No hay datos de análisis para exportar.",
  "CSV Export Successful!": "¡Exportación CSV exitosa!",
  "Analytics data exported to CSV file.": "Los datos de análisis se exportaron a un archivo CSV.",
  "Excel Export Successful!": "¡Exportación a Excel exitosa!",
  "Analytics data exported to Excel file.": "Los datos de análisis se exportaron a un archivo de Excel.",
  "Export Failed": "Error al exportar",
  "Failed to export analytics data to CSV. Please try again.": "No se pudieron exportar los datos a CSV. Inténtalo nuevamente.",
  "Failed to export analytics data to Excel. Please try again.": "No se pudieron exportar los datos a Excel. Inténtalo nuevamente.",

  "Warehouse Management": "Gestión de almacenes",
  "Manage warehouse locations, allocate stock, and transfer inventory between warehouses.": "Administra las ubicaciones de almacenamiento, asigna existencias y transfiere inventario entre almacenes.",
  "Total Warehouses": "Total de almacenes",
  "Active Warehouses": "Almacenes activos",
  "Inactive Warehouses": "Almacenes inactivos",
  "All locations": "Todas las ubicaciones",
  Operational: "Operativos",
  "Not in use": "Sin uso",
  "Main Warehouse": "Almacén principal",
  Storage: "Almacenamiento",
  "Secondary Warehouse": "Almacén secundario",
  Hub: "Centro de distribución",
  Store: "Tienda",
  Others: "Otros",
  "Search by name or address...": "Buscar por nombre o dirección...",
  "All Warehouses": "Todos los almacenes",
  "Export Warehouses": "Exportar almacenes",
  Name: "Nombre",
  Address: "Dirección",
  Type: "Tipo",
  Status: "Estado",
  "Stock share": "Participación del stock",
  Created: "Creado",
  Actions: "Acciones",
  Active: "Activo",
  Inactive: "Inactivo",

  "Supplier Management": "Gestión de proveedores",
  "Manage your supplier relationships efficiently. Track supplier information, status, and maintain detailed records for better inventory management and procurement planning.": "Administra eficientemente las relaciones con tus proveedores, consulta su información y mantén registros detallados para mejorar la gestión del inventario y la planificación de compras.",
  "Total Suppliers": "Total de proveedores",
  Suppliers: "Proveedores",
  "All Suppliers": "Todos los proveedores",
  "Export Suppliers": "Exportar proveedores",
  "Search by Supplier Name...": "Buscar por nombre del proveedor...",
  "Supplier & Email": "Proveedor y correo",
  Description: "Descripción",
  "Created At": "Creado el",
  "Updated At": "Actualizado el",

  "Category Management": "Gestión de categorías",
  "Organize your inventory with a comprehensive category system. Create, manage, and maintain product categories to streamline your inventory organization and improve product discoverability.": "Organiza tu inventario mediante un sistema completo de categorías para facilitar la gestión y búsqueda de productos.",
  Categories: "Categorías",
  "Product categories": "Categorías de productos",
  "All Categories": "Todas las categorías",
  "Export Categories": "Exportar categorías",
  "Search by Category Name...": "Buscar por nombre de categoría...",
  Category: "Categoría",
  Products: "Productos",

  "Product Inventory Management": "Gestión de inventario de productos",
  "Efficiently manage your product catalog with advanced filtering, search capabilities, and real-time stock tracking. Monitor inventory levels, organize by categories and suppliers, and maintain optimal stock control.": "Administra tu catálogo de productos con filtros avanzados, búsqueda y seguimiento del inventario en tiempo real. Controla las existencias y organiza tus productos por categorías y proveedores.",
  "Products availability": "Disponibilidad de productos",
  Available: "Disponibles",
  "Stock low": "Stock bajo",
  "Stock Low": "Stock bajo",
  "Stock out": "Agotados",
  "Stock Out": "Agotados",
  "Search by Name or SKU...": "Buscar por nombre o SKU...",
  "Import Products": "Importar productos",
  "Export Products": "Exportar productos",
  "Product or SKU": "Producto o SKU",
  "QR and stock": "QR y stock",
  Price: "Precio",
  "Creation / Expiration": "Creación / vencimiento",
  Supplier: "Proveedor",

  "Order Management": "Gestión de pedidos",
  "Manage client orders, track order status, monitor payments, and handle shipping. View order history, update statuses, and process cancellations.": "Gestiona los pedidos de clientes, consulta su estado, controla los pagos y administra los envíos. Consulta el historial, actualiza estados y procesa cancelaciones.",
  "Total Orders": "Total de pedidos",
  "Total orders placed (self + client)": "Total de pedidos realizados (propios y de clientes)",
  "Total Revenue": "Ingresos totales",
  "Profits (excl. cancelled)": "Ingresos (sin pedidos cancelados)",
  Paid: "Pagados",
  Partial: "Parciales",
  Due: "Pendientes de pago",
  Pending: "Pendientes",
  Confirmed: "Confirmados",
  Shipping: "En envío",
  Delivered: "Entregados",
  Refund: "Reembolsados",
  Cancel: "Cancelados",
  "Export Orders": "Exportar pedidos",
  Payment: "Pago",
  "Cancelled": "Cancelado",
  Refunded: "Reembolsado",
  Unpaid: "No pagado",

  "Invoice Management": "Gestión de facturas",
  "Manage invoices, track payment status, monitor due dates, and handle billing. View invoice history, update statuses, and send invoices to clients.": "Administra las facturas, consulta el estado de los pagos, controla las fechas de vencimiento y gestiona la facturación.",
  "Total invoices (store-wide)": "Total de facturas",
  "No invoices found.": "No se encontraron facturas.",
  "Search by Invoice #...": "Buscar por número de factura...",
  "Export Invoices": "Exportar facturas",
  "Invoice #": "N.º de factura",
  "Order #": "N.º de pedido",
  "Total": "Total",

  "Store Overview": "Resumen de la tienda",
  "My Store": "Mi tienda",
  "My Activity": "Mi actividad",
  "User Management": "Gestión de usuarios",
  "Activity History": "Historial de actividad",
  "Client Portal": "Portal de clientes",
  "Supplier Portal": "Portal de proveedores",
  "Support Tickets": "Tickets de soporte",
  "Product Reviews": "Reseñas de productos",
  "Store Analytics & Dashboard (self + client + supplier + other users)": "Análisis y panel de la tienda (propios, clientes, proveedores y otros usuarios)",

  // Business Insights — warehouse rollup tab.
  "Warehouse stock rollup": "Resumen de stock por almacén",
  "Allocated inventory across locations": "Inventario asignado entre las distintas ubicaciones",
  "Locations with stock": "Ubicaciones con stock",
  "Allocated units": "Unidades asignadas",
  "Reserved units": "Unidades reservadas",
  "Committed on active orders": "Comprometidas en pedidos activos",
  "Inventory value": "Valor del inventario",
  "No allocations yet": "Aún no hay asignaciones",
  "Quantity by warehouse": "Cantidad por almacén",
  "Stock share by warehouse": "Participación del stock por almacén",
  "Warehouse Breakdown": "Desglose por almacén",
  Warehouse: "Almacén",
  SKUs: "SKU",
  Quantity: "Cantidad",
  Reserved: "Reservado",
  Value: "Valor",
  "Total allocated units at this warehouse": "Total de unidades asignadas en este almacén",
  "Units reserved for open orders (amber/rose when elevated)": "Unidades reservadas para pedidos abiertos (ámbar/rosa cuando el nivel es elevado)",
  "Estimated inventory value from allocated stock": "Valor estimado del inventario a partir del stock asignado",
  "No warehouse allocations yet. Allocate stock from a warehouse detail page.": "Aún no hay asignaciones de almacén. Asigna stock desde la página de detalle del almacén.",
  "warehouses total": "almacenes en total",
  "SKU rows": "filas de SKU",
  "Top:": "Principal:",

  // Administration and user-management UI.
  "Product & System Management": "Gestión de productos y sistema",
  "Personal activity": "Actividad personal",
  "System Settings": "Configuración del sistema",
  "Email Preferences": "Preferencias de correo",
  "Loading count": "Cargando cantidad",
  "Cargando cantidad": "Cargando cantidad",
  "All registered users": "Todos los usuarios registrados",
  "Users with role admin": "Usuarios con rol de administrador",
  "Users with role supplier": "Usuarios con rol de proveedor",
  "Users with role client": "Usuarios con rol de cliente",
  "Search by name, email, or username...": "Buscar por nombre, correo o nombre de usuario...",
  Role: "Rol",
  "Filter by role...": "Filtrar por rol...",
  "No role found.": "No se encontró ningún rol.",
  "Clear Filters": "Limpiar filtros",
  User: "Usuario",
  Admin: "Administrador",
  "Client": "Cliente",
  Retailer: "Minorista",
  "Sort by": "Ordenar por",
  Asc: "Ascendente",
  Desc: "Descendente",
  Joined: "Registro",
  View: "Ver",
  "View Detail": "Ver detalle",
  "Edit User": "Editar usuario",
  "Delete User": "Eliminar usuario",
  "Total Users": "Total de usuarios",
  "Manage users and roles. View and update name, role, and profile.": "Gestiona usuarios y roles. Consulta y actualiza el nombre, rol y perfil.",
};

const ATTRIBUTE_NAMES = ["placeholder", "aria-label", "title", "alt"];

function translateElement(root: ParentNode) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let current: Node | null = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const node of textNodes) {
    const raw = node.nodeValue ?? "";
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const translated = TRANSLATIONS[trimmed];
    if (!translated || translated === trimmed) continue;
    const start = raw.indexOf(trimmed);
    node.nodeValue = `${raw.slice(0, start)}${translated}${raw.slice(start + trimmed.length)}`;
  }

  if (root instanceof Element) {
    const elements = [root, ...Array.from(root.querySelectorAll("*"))];
    for (const element of elements) {
      for (const attribute of ATTRIBUTE_NAMES) {
        const value = element.getAttribute(attribute);
        if (!value) continue;
        const translated = TRANSLATIONS[value.trim()];
        if (translated && translated !== value) {
          element.setAttribute(attribute, translated);
        }
      }
    }
  }
}

export function SpanishUiProvider() {
  useEffect(() => {
    translateElement(document.body);

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of Array.from(mutation.addedNodes)) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            translateElement(node as Element);
          } else if (node.nodeType === Node.TEXT_NODE) {
            const text = node.nodeValue?.trim() ?? "";
            const translated = TRANSLATIONS[text];
            if (translated) node.nodeValue = translated;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return null;
}
