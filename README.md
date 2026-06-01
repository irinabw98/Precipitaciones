# Irina Labs · Lluvias y aplicaciones

Herramienta web estática para pegar una tabla de actividades por localidad y generar:

- una tabla filtrada desde la lluvia previa a la primera aplicación hasta la lluvia posterior a la última aplicación de cada localidad;
- gráficos por localidad con barras de precipitación/irrigación, líneas continuas para aplicaciones y líneas punteadas para assessments;
- descarga del resultado filtrado en CSV;
- descarga individual de cada gráfico en PNG.

## Columnas esperadas

La app reconoce estas columnas principales:

| Dato | Nombre recomendado |
|---|---|
| Localidad | `Trial_mod` |
| Fecha | `activity_date` |
| Descripción | `activity_description` |
| Código | `activity_timing_code` o `activity_code` |
| Precipitación / irrigación | `Avg(irrigation_amount)` |

También reconoce variantes simples como `Localidad`, `Fecha`, `Activity code`, `irrigation_amount`, `mm`, `lluvia` o `precipitación`.

## Lógica de procesamiento

Para cada localidad:

1. Ordena los registros por fecha.
2. Detecta todas las filas donde `activity_description` sea `Application`.
3. Toma como inicio la lluvia anterior a la primera aplicación.
4. Toma como final la lluvia posterior a la última aplicación.
5. Conserva todas las filas intermedias: lluvias, aplicaciones, assessments y otros eventos.

La última aplicación puede ser `A`, `B`, `C`, `D` u otro código. La condición principal es que la descripción sea `Application`.

## Uso local

Abrir `index.html` en el navegador y pegar la tabla copiada desde Excel o Spotfire.

## Publicación en GitHub Pages

1. Crear un repo nuevo.
2. Subir estos archivos a la raíz del repo:
   - `index.html`
   - `styles.css`
   - `app.js`
   - carpeta `assets`
3. En GitHub, entrar a `Settings` → `Pages`.
4. En `Build and deployment`, seleccionar `Deploy from a branch`.
5. Elegir branch `main` y carpeta `/root`.
6. Guardar.

