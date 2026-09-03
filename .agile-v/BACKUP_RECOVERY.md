# FASE 6 — Backup y recuperación

## Política de producción

Stockly usa MongoDB Atlas como base de datos de producción. La recuperación de producción debe depender de **Cloud Backup + Continuous Cloud Backup (PIT)** de Atlas, no de un backup ejecutado desde una función de Vercel. Atlas permite snapshots administrados y recuperación a un punto en el tiempo mediante el oplog.

### Objetivos recomendados

- RPO objetivo: ≤ 1 hora; con Continuous Cloud Backup habilitado puede reducirse hasta aproximadamente 1 minuto.
- RTO objetivo: ≤ 4 horas para una restauración de producción validada.
- Retención mínima sugerida: snapshots diarios 30 días, semanales 12 semanas y mensuales 12 meses.
- Mantener una copia de snapshots en una segunda región cuando el plan de Atlas lo permita.
- Activar Backup Compliance Policy para datos de producción cuando las necesidades operativas y de cumplimiento lo justifiquen.

## Runbook de recuperación

1. Declarar incidente y congelar cambios/deploys.
2. Identificar el timestamp inmediatamente anterior al incidente.
3. En Atlas, seleccionar Point-in-Time Restore o el snapshot adecuado.
4. Restaurar primero a un cluster de recuperación; validar colecciones críticas, índices y conteos.
5. Ejecutar smoke tests de autenticación, productos, ventas, inventario, caja, órdenes de servicio y reportes.
6. Promover el cluster restaurado según el procedimiento de infraestructura y actualizar `DATABASE_URL` si corresponde.
7. Verificar producción y registrar el incidente en auditoría.
8. Reanudar deploys y cambios solamente después de la validación.

## Errores de aplicación

Las rutas críticas deben fallar de forma segura: no confirmar una operación financiera/inventario si una escritura secundaria falla. Los flujos existentes de ventas, pagos, inventario y órdenes de servicio deben conservar sus protecciones transaccionales/idempotentes y continuar agregando compensación donde MongoDB no permita una transacción completa.

## Validación operativa pendiente de infraestructura

La activación real de Cloud Backup/PIT depende de la configuración del proyecto MongoDB Atlas y no puede inferirse únicamente desde el repositorio. Antes de marcar esta parte como operativamente verificada, un Project Owner/Backup Manager debe confirmar en Atlas que la política está activa y ejecutar una restauración de prueba en un cluster aislado.
