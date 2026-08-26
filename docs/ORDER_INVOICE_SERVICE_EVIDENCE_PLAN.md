# Stockly — Ajustes de Pedidos, Facturas y Servicio Técnico

## Pedidos
- El pedido es la operación comercial principal.
- Flujo: cliente → productos/cantidades → descuentos → total → pago → actualización de inventario.
- Desde un pedido se debe poder consultar, registrar pago y generar factura.

## Facturas
- La factura es el documento generado a partir de un pedido confirmado.
- No debe duplicar el registro de la venta.
- Debe permitir consultar, buscar, ver/descargar/imprimir y controlar el estado de la factura.

## Servicio Técnico — Evidencia fotográfica
Cada orden debe soportar evidencias separadas por etapa:

1. Estado de ingreso
   - Frente, espalda, laterales, superior/inferior y detalles de daños cuando corresponda.
   - Cámara del dispositivo o selección desde galería.
   - Carga múltiple, vista previa y eliminación/reemplazo.

2. Durante reparación
   - Fotografías del proceso y componentes/reparación.

3. Estado de entrega
   - Evidencia final del equipo antes de entregarlo.

Las fotografías deben quedar asociadas a la orden de servicio y a su etapa. El módulo también debe registrar el estado físico/observaciones de ingreso.

## Criterio de aceptación
- Una venta no debe registrarse dos veces para generar su factura.
- Una factura debe poder originarse desde el pedido.
- Una orden de servicio debe permitir evidencias de ingreso, reparación y entrega, sin mezclar las etapas.
