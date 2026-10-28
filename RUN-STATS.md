# Run stats — caballo procedural en Three.js

**Fecha:** 2026-10-28  
**Sesión OpenCode:** `ses_e7dd4483…`  
**Modelo:** `deepseek/deepseek-flash` (variante `max`)  
**Corte de datos:** 11:31:03 UTC (el último turno seguía en curso; las cifras finales son ligeramente superiores)  
**Entorno:** macOS, Chrome headless, 1440×900, DPR 1

## Resumen

| Métrica | Valor |
|---|---:|
| Duración total de la sesión | 29 min 58 s |
| Duración del build principal (primer prompt → última iteración visual) | 23 min 13 s |
| Primer render verificado en navegador | 4 min 48 s desde el primer prompt |
| Llamadas al modelo (steps de OpenCode) | 102 |
| Llamadas a herramientas | 180 |
| Tokens de entrada sin caché | 72.426 |
| Tokens de salida | 66.855 |
| Tokens de razonamiento | 130.797 |
| Tokens leídos desde caché | 16.970.624 |
| Coste registrado por OpenCode | 0,180367 |
| Archivos de código creados | 3 (+2 vendorizados) |
| Líneas de código | 1.934 totales · 1.607 efectivas |

El build principal (los dos primeros prompts) costó **0,154471** y consumió **83 llamadas al modelo**. El resto del coste corresponde a la consulta de `realpath` y a este informe.

## Tiempo

| Turno | Inicio | Último step | Duración | Steps | Tool calls |
|---|---:|---:|---:|---:|---:|
| 1. Caballo en Three.js | 11:01:05 | 11:06:31 | 5 min 26 s | 13 | 15 |
| 2. Fondo verde + pulido visual | 11:07:00 | 11:24:18 | 17 min 18 s | 70 | 143 |
| 3. `realpath` | 11:25:25 | 11:25:30 | 5 s | 2 | 1 |
| 4. Estadísticas (en curso) | 11:27:44 | 11:31:03 | 3 min 19 s | 17 | 21 |

- **Build principal, reloj de pared:** 11:01:05 → 11:24:18 = **23 min 13 s**.
- **Tiempo activo de esos dos turnos** (excluyendo la pausa de 29 s entre ambos): **22 min 44 s**.
- **Sesión completa al corte:** 11:01:05 → 11:31:03 = **29 min 58 s**.
- Son tiempos de reloj de pared: incluyen latencia del modelo, ejecución de herramientas, capturas de Playwright y pausas del usuario. No son tiempo de escritura manual ni de CPU.
- El primer render con la página funcionando se verificó a las **11:05:53**, 4 min 48 s después del prompt inicial.

## Tokens y coste

| Turno | Coste | Input | Output | Razonamiento | Cache read | Total procesado |
|---|---:|---:|---:|---:|---:|---:|
| 1. Caballo | 0,041697 | 9.557 | 17.722 | 46.421 | 592.640 | 666.340 |
| 2. Fondo + pulido | 0,112774 | 50.557 | 43.671 | 72.702 | 11.788.800 | 11.955.730 |
| 3. `realpath` | 0,001564 | 432 | 60 | 17 | 484.352 | 484.861 |
| 4. Estadísticas | 0,024332 | 11.880 | 5.402 | 11.657 | 4.104.832 | 4.133.771 |
| **Total** | **0,180367** | **72.426** | **66.855** | **130.797** | **16.970.624** | **17.240.702** |

- **Build principal:** 0,154471 · 60.114 input · 61.393 output · 119.123 razonamiento · 12.381.440 cache read = **12.622.070 tokens procesados**.
- **Cache write:** 0 en todos los casos.
- El **98,4 %** de los tokens procesados fueron lecturas de caché. Eso explica que 17,2 M de tokens procesados cuesten ~0,18: el contexto repetido se sirve desde caché.
- Coste del build principal por llamada al modelo: **≈ 0,00186** (0,19 céntimos por llamada).
- Coste del build principal por minuto activo: **≈ 0,00665**.
- Reparto del coste al corte: turno 1 23,1 %, turno 2 62,5 %, turno 3 0,9 %, turno 4 13,5 %.
- El campo `cost` es el que registra OpenCode para la sesión (se asume USD; conviene contrastarlo con la factura del proveedor).

### Herramientas más usadas

| Herramienta | Llamadas |
|---|---:|
| `edit` | 74 |
| `bash` | 56 |
| `read` | 44 |
| `write` | 3 |
| `todowrite` | 2 |
| `skill` | 1 |
| **Total** | **180** |

El turno 2 concentra 73 de las 74 ediciones: la mayor parte del esfuerzo fue iteración visual (melena, proporciones de cabeza/cuello, encuadre móvil, colores), no la generación inicial del esqueleto de código.

## Código generado

| Archivo | Líneas | Bytes | Líneas efectivas* |
|---|---:|---:|---:|
| `horse-demo/index.html` | 68 | 3.438 | 63 |
| `horse-demo/styles.css` | 611 | 11.371 | 523 |
| `horse-demo/horse.js` | 1.255 | 43.633 | 1.021 |
| **Total** | **1.934** | **58.442** | **1.607** |

\* Sin líneas en blanco ni líneas que solo contienen comentarios. El total incluye 52 líneas de comentarios y 275 en blanco.

- **Archivos escritos por el modelo:** 3 (`index.html`, `styles.css`, `horse.js`).
- **Archivos vendorizados:** `vendor/three.module.js` (1.314.681 bytes) y `vendor/THREE-LICENSE`.
- **Configuración modificada:** `eslint.config.mjs` (+5/−1) para ignorar el vendor en ESLint.
- **Tamaño del código propio:** 58.442 bytes (~57 KiB); ~15.979 bytes (~15,6 KiB) comprimido con gzip.
- **Three.js vendorizado:** 1,31 MB; ~260 KiB con gzip.
- **Carpeta completa:** ~1,4 MB.
- **Assets externos:** ninguno de 3D; el modelo del caballo es 100 % procedural. Solo se cargan tipografías desde Google Fonts.

## Escena 3D

Medido con `renderer.info` después de 2,5 s de render:

| Métrica | Caballo | Escena completa |
|---|---:|---:|
| Meshes | 104 | 213 |
| Grupos | 60 | 89 |
| Materiales | 12 | 22 |
| Triángulos | 67.772 | 84.872 |
| Draw calls | — | 140 |
| Luces | — | 3 |

- **60 fps** a 1440×900 y DPR 1 en Chrome headless sobre esta máquina. No es un benchmark general: depende de GPU, navegador y resolución.
- 10 programas de shader, 91 geometrías y 3 texturas en memoria en el momento de la medición.
- La escena incluye hierba instanciada, árboles low-poly, colinas, cielo con shader, sombras PCF y partículas de polvo.

## Verificación

- Playwright/Chrome en **1440×900, 768×1024, 390×844, 375×812 y 1200×800**: sin errores de consola, sin overflow horizontal.
- Interacciones comprobadas: pausa/reanudación de `Wander`, WASD después de hacer foco en un botón, Space para alternar el autowalk, slider de ritmo, zoom y órbita.
- `prefers-reduced-motion`: arranca parado y sin animaciones de entrada; el usuario puede activar el paseo manualmente.
- `npm run lint` y `npm run typecheck`: pasan.
- 44 capturas de navegador tomadas durante la QA visual; quedaron 16 archivos finales (11 estados y 5 frames del ciclo). Las demás se regeneraron para comparar iteraciones.

## Lectura para el blog

**Qué funcionó bien**

- El primer prompt era claro y completo (Three.js, web local, interactivo, caminar). La primera versión funcional apareció en menos de 5 minutos y ya incluía cámara orbital, paseo automático, WASD, slider y UI.
- La referencia visual del segundo prompt sirvió para fijar rápido la dirección del fondo: pradera verde, cielo azul y árboles low-poly. Se respetó la instrucción de ignorar el caballo de la imagen.
- La verificación visual con capturas fue decisiva: detectó problemas que el código por sí solo no revela (encuadre móvil demasiado cerrado, melena con aspecto de púas/toalla, cola oculta, iluminación lavada).
- El coste es bajo (~0,15 para el build principal) gracias al modelo Flash y, sobre todo, a las lecturas de caché.

**Dónde se fue el esfuerzo**

- La anatomía y el pelo del caballo son la parte más difícil de resolver con primitivas. Se necesitaron muchas iteraciones de melena, cuello, cabeza, orejas y proporciones.
- El turno 2 mezcló dos cosas: el cambio de fondo pedido y pulido adicional del caballo. De ahí sus 70 steps, 143 tool calls y 0,112774 de coste.
- El coste no está en escribir las 1.607 líneas iniciales, sino en el bucle de QA visual.

**Límites del resultado**

- Es un caballo estilizado/low-poly, no un asset de producción: no hay IK, los cascos pueden deslizar ligeramente y la anatomía no es rigurosa.
- El render de 60 fps es una medición puntual en headless, no una garantía.
- Los totales de tokens y coste son de una sola corrida; cambian con el modelo, el contexto y la caché.
- El turno de estadísticas seguía abierto al hacer el corte; el informe y la respuesta final añaden unos pocos miles de tokens más.

**Qué ajustaría en los prompts**

- Decir desde el inicio el estilo deseado: “low-poly estilizado, melena flaxen, sin IK, encuadre 3/4 y composición segura en móvil”.
- Separar el rediseño de fondo del pulido del modelo para poder medir el coste de cada intención.
- Pedir explícitamente una ronda de QA responsive si se quiere evitar que el agente la descubra por su cuenta.

## Metodología

- **Tokens, coste, steps y tool calls:** base de datos local de OpenCode (`~/.local/share/opencode/opencode.db`), tablas `session`, `message` y `part`. Los tokens por turno se agrupan por `parentID` del mensaje del usuario y coinciden con los totales de `session` en el corte.
- **Duración:** diferencia entre el `time_created` del mensaje del usuario y el último `time_created` de un step del asistente. Incluye latencia y esperas.
- **LOC:** `wc -l` y conteo propio de líneas en blanco y comentarios; excluye `vendor/`. No incluye este informe.
- **Escena 3D:** `renderer.info` y recorrido del grafo de escena tras 2,5 s; los triángulos de `InstancedMesh` se multiplican por el número de instancias.
- **Una sola corrida.** No es un benchmark estadístico; úsese como caso de estudio.

### Refrescar los totales

```bash
sqlite3 -readonly ~/.local/share/opencode/opencode.db \
  "SELECT round(cost,6), tokens_input, tokens_output, tokens_reasoning,
          tokens_cache_read, tokens_cache_write
   FROM session WHERE title='Interactive Three.js walking horse';"
```

```bash
wc -l horse-demo/index.html horse-demo/styles.css horse-demo/horse.js
```
