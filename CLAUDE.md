# Última Ronda

Shooter 3D en primera persona de supervivencia por rondas contra zombis, para navegador de escritorio. Reproduce las mecánicas del género (rondas, puntos, puertas, armas de pared, caja aleatoria, ventajas, mejora de armas) con nombre, mundo, arte y sonido propios.

El documento de diseño completo es `docs/GDD.md`. Léelo entero antes de la primera tarea y relee la sección que corresponda antes de tocar cada sistema. Si el código y el GDD se contradicen, manda el GDD. Si crees que el GDD se equivoca, dilo y espera respuesta antes de cambiar nada.

## Cómo trabajamos

- Alejandro dirige y prueba; no programa. Explica cada cambio en español llano y termina siempre con cómo probarlo: qué abrir, qué hacer y qué debería verse.
- **Fase actual: 2 · Vertical slice.** La fase 0 se cerró el 2026-11-11 (cubo publicado en https://alejandrodiazfuentes01-web.github.io/ultima-ronda/; cada `git push` a `main` pasa las pruebas y publica). La fase 1 se cerró el 2026-11-11: prototipo gris jugable con buen rendimiento y renderizador decidido; lo que faltaba para que divierta (ambiente y objetivos) es el trabajo de la fase 2. Trabaja solo en la fase actual. Las fases y sus criterios de salida están en la sección «Hoja de ruta de producción» del GDD. No adelantes trabajo de fases posteriores. Cuando se cumpla un criterio de salida, dilo y actualiza esta línea.
- Nada entra en el juego si no está en el GDD. Las ideas nuevas, tuyas o de Alejandro, se apuntan en `docs/DESPUES.md`.
- Al final de cada sesión el juego arranca y se puede jugar, aunque tenga menos cosas.
- Cambios pequeños y un commit por cambio, con mensaje que diga qué cambia para el jugador.
- Si una tarea es ambigua o toca una decisión de diseño, pregunta antes de escribir código.

## Tecnología

- TypeScript en modo estricto, Vite.
- Three.js con `WebGPURenderer` de `three/webgpu` (cae a WebGL 2 de forma automática). Decidido el 2026-11-11, tras probar el prototipo gris: se queda así. `?renderer=webgl` sigue sirviendo para forzar WebGL 2 al medir.
- Rapier para física, colisiones y trazado de rayos.
- recast-navigation-js para la malla de navegación y la multitud de enemigos.
- Web Audio API para el sonido posicional.
- Interfaz en HTML y CSS sobre el canvas.
- Vitest para las pruebas.
- Colyseus para el servidor, solo desde la fase 4.

No añadas dependencias sin decir cuánto pesan y por qué hacen falta.

## Estructura del repositorio

```text
shared/   simulación del juego y datos de balance (TypeScript puro)
client/   render, audio, entrada, interfaz
server/   vacío hasta la fase 4
docs/     GDD.md, DESPUES.md, LICENCIAS.md
```

## Reglas de arquitectura

Estas reglas no se rompen aunque una tarea sea más fácil rompiéndolas.

1. `shared/` no importa Three.js, ni el DOM, ni nada del navegador. Debe poder ejecutarse en Node sin gráficos: el servidor del cooperativo usará ese mismo código.
2. La simulación avanza a paso fijo de 60 Hz. El render interpola entre estados. La velocidad del juego no depende de la tasa de refresco del monitor.
3. Ningún número de balance en el código. Vida, daño, costes, cadencias y curvas viven en `shared/data/*.json`, con tipos que los validan al cargar. Los valores iniciales están en «Números y balance» del GDD.
4. Nada de sombreadores GLSL a medida: ni `ShaderMaterial`, ni `RawShaderMaterial`, ni `onBeforeCompile`. Solo materiales integrados o nodos TSL.
5. Enemigos, partículas, casquillos y textos flotantes salen de reservas de objetos reutilizables. No crear ni destruir objetos en plena horda.
6. Controles: captura de ratón con Pointer Lock. Nada asignado a Ctrl. Escape es siempre el menú de pausa.
7. Todo acceso a `localStorage` va dentro de `try/catch`.
8. Ningún texto visible escrito en el código. Los textos van en archivos de idioma; el juego sale en inglés y español.
9. Rutas de assets siempre relativas.
10. Ninguna petición a dominios externos en ejecución: ni fuentes, ni CDN, ni analítica de terceros. La única excepción será el servidor de juego en la fase 4.

## Presupuestos

| Recurso | Límite |
| --- | --- |
| Fotogramas | 60 por segundo en portátil con gráfica integrada a 1080p; 30 en un Chromebook de 4 GB con calidad baja |
| Llamadas de dibujo | 150 por fotograma |
| Triángulos visibles | 300.000 |
| Enemigo | 3.000–5.000 triángulos y 30 huesos |
| Enemigos vivos a la vez | 24 en solitario, tope de 32 |
| Descarga hasta poder jugar | 15 MB |
| Descarga total | 60 MB |
| Archivos en el build | 1.500 como máximo |

Si un cambio acerca el juego a un límite, avisa. Si lo supera, no lo des por terminado.

## Contenido y marca

- Apto para PEGI 12: sin sangre realista ni desmembramientos. Los enemigos se deshacen en ceniza y desaparecen.
- No uses nombres ni marcas del juego original en ningún sitio: ni en código, ni en nombres de archivo, ni en textos, ni en comentarios. Los nombres del original solo aparecen en el GDD como referencia de diseño.
- Nombres propios del juego: Estación Aurora (mapa), los Vacíos (enemigos), El Contenedor (caja aleatoria), La Forja (mejora de armas), sueros Coraza, Pulso, Doble filo y Segundo aliento, power-ups Munición completa, Baja instantánea, Puntos dobles y Onda expansiva, arma especial Arco voltaico.
- Las armas se basan en armas reales, pero en el juego llevan designación militar o nombre genérico (M1911, M870, SMG-5, V-45, AK-74, M16, Mk 17, M249, SVD). Ningún modelo ni textura lleva marca o logotipo de fabricante.
- Cada asset que entra al repositorio se apunta en `docs/LICENCIAS.md`: qué es, con qué herramienta se generó o de dónde viene, y bajo qué condiciones de uso.

## Pruebas

- Las pruebas deben pasar antes de dar un cambio por terminado. Si no las has ejecutado, dilo.
- Cada regla nueva de la simulación llega con su prueba: curvas de ronda, puntos por tipo de baja, compras sin saldo, límite de sueros, traslado de El Contenedor.
- Desde la fase 1 existe un jugador automático que juega 30 rondas sin gráficos y falla si hay enemigos atascados, rondas que no terminan o puntos negativos.
- El build falla si supera el presupuesto de descarga.

## Comandos

Mantén esta sección al día. Requieren Node 22 o posterior y `npm install` la primera vez.

```text
npm run dev        servidor de desarrollo (http://localhost:5173)
npm run build      comprueba tipos, genera dist/ y falla si supera el presupuesto de descarga
npm run preview    sirve el build de dist/ (http://localhost:4173)
npm test           pruebas, incluido el jugador automático de 30 rondas (unos 40 s)
```

Para medir el renderizador: el contador de arriba a la izquierda muestra fotogramas, el 1 % más lento, llamadas de dibujo, triángulos y el renderizador en uso. Añadir `?renderer=webgl` a la dirección fuerza WebGL 2.

Herramientas de prueba en la dirección del juego (el jugador normal no las ve):

```text
?ronda=8         empieza la partida en la ronda 8
&puntos=5000     empieza con esos puntos
?pruebas         al caer, enseña el resumen de la partida con un botón para copiarlo
```
