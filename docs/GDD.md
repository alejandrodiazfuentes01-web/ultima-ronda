# Plan de diseño: shooter de zombis por rondas para navegador

Versión del 9 de noviembre de 2026. Documento de diseño de referencia del proyecto.

## Resumen y supuestos

El plan lleva a un shooter 3D en primera persona de supervivencia por rondas, jugable en el navegador sin instalar nada, con lanzamiento público en unos 11 meses. Reproduce las mecánicas y el ritmo de Black Ops 3 Zombies, con nombre, mundo, personajes, arte y sonido propios. Nombre definitivo del proyecto: **Última Ronda**.

La estrategia es lanzar dos veces. Primero una versión en solitario, pública y gratuita, al terminar la alfa. Después el cooperativo de 2 a 4 jugadores, que es la parte más cara y arriesgada.

| Decisión | Elección | Motivo |
| --- | --- | --- |
| Plataforma | Navegador de escritorio, teclado y ratón | Un FPS necesita captura de ratón; el móvil exige otro diseño de controles y un tercio del presupuesto gráfico |
| Tecnología | TypeScript, Three.js, física Rapier, empaquetado con Vite | Builds pequeños, control total del tamaño de descarga y gran ecosistema |
| Modo de juego | Solitario primero; cooperativo 2–4 después | La fórmula se valida sin red; la red multiplica el trabajo |
| Contenido de lanzamiento | 1 mapa, 10 armas, 4 ventajas, 4 power-ups, 1 enemigo especial, 1 misión secreta corta | Un mapa pulido retiene más que tres a medias |
| Modelo de negocio | Gratis con anuncios, en portales de juegos web y dominio propio | Es el modelo estándar del juego web; sin pagos que integrar |
| Clasificación de contenido | Apta para PEGI 12: sin desmembramientos ni sangre realista | Requisito de CrazyGames, el portal principal del plan |

Supuestos que he tomado y que cambian el plan si no se cumplen:

- La IA produce todo: código, modelos, texturas, animaciones y sonido. Tú diriges, pruebas cada versión y decides, unas 10–12 horas semanales.
- No necesitas programar, pero sí jugar cada versión: la IA no puede juzgar si algo divierte.
- Presupuesto de assets y servicios por debajo de 500 € hasta el lanzamiento.
- El objetivo es un producto publicable y monetizable, no un mod privado.

## Marco legal: inspirado, no clonado

Las mecánicas de Black Ops 3 Zombies se pueden reproducir; su expresión concreta, no. Las reglas de un juego son ideas y no tienen derechos de autor. Los nombres, personajes, mapas, modelos, música, voces e interfaz sí están protegidos, por derechos de autor o por marca.

Esto decide el proyecto entero: un juego con assets o nombres del original puede recibir una retirada en cualquier momento, y ningún portal lo aceptará.

| Elemento | Qué puedes hacer | Qué debes evitar |
| --- | --- | --- |
| Reglas y sistemas | Rondas, puntos por impacto, puertas de pago, armas de pared, caja aleatoria, ventajas, mejora de armas, power-ups, reanimación | Nada: las reglas son libres |
| Nombres | Inventar los tuyos para el juego, ventajas, armas, mapa y personajes | «Call of Duty», «Black Ops» y los nombres propios del original, también en título, etiquetas y anuncios |
| Mapas | Un mapa propio con la misma lógica de flujo | Reproducir la distribución de un mapa existente |
| Arte y modelos | Assets propios, comprados con licencia comercial o generados | Modelos o texturas extraídos del juego, aunque circulen por la comunidad |
| Audio | Música, voces y efectos originales o con licencia | Sintonías de ronda, jingles de máquinas, voces o efectos del original |
| Presentación | Una ficción visual distinta para cada sistema | Copiar el aspecto: máquinas de refrescos con jingle, la misma caja, el mismo HUD |
| Armas | Modelos basados en armas reales, con designación militar o nombre genérico | Marcas y logotipos de fabricantes, y las armas especiales del original |

Copiar solo el aspecto también es un riesgo. En *Tetris Holding v. Xio Interactive* (EE. UU., 2012) un clon sin código ni assets copiados perdió por imitar la presentación visual. Por eso cada sistema de este plan lleva una ficción propia.

En la comunicación, describe el género: «shooter de zombis por rondas». No uses las marcas del original para promocionarte.

Esto no es asesoramiento jurídico. Antes de monetizar en serio conviene una consulta con un abogado de propiedad intelectual.

## Pilares de diseño y bucle de juego

La esencia de la fórmula es una decisión que se repite cada minuto: gastar puntos para sobrevivir ahora o ahorrarlos para ser más fuerte después. Todo sistema del juego debe alimentar esa decisión; lo que no la alimente, sobra.

Seis pilares que el juego debe respetar para sentirse como el original:

1. **Los puntos son la única progresión dentro de la partida.** Se ganan disparando y lo compran todo: espacio, armas, ventajas y mejoras. No hay equipamiento previo que los sustituya.
2. **El mapa es un puzle que se abre.** Empiezas encerrado. Cada puerta da espacio y acceso, pero también abre más entradas de zombis.
3. **Escalada sin fin.** No se gana: se aguanta. La puntuación es la ronda alcanzada, y la derrota siempre llega.
4. **Dominio por conocimiento.** La habilidad está en controlar la horda: agruparla, moverla en círculos, conocer rutas y saber dónde está cada cosa. La puntería ayuda, pero no basta.
5. **Azar dosificado.** La caja aleatoria y los power-ups crean historias distintas en cada partida. El resto es determinista y aprendible.
6. **Cooperación con consecuencias.** Reanimar a un compañero es arriesgado, y caer cuesta todas las ventajas.

El juego funciona en tres escalas de tiempo. El bucle corto dura 30 segundos: disparar, cobrar, recolocarse. La ronda dura de 2 a 5 minutos y termina con una pausa de 10 segundos para comprar. La partida dura de 20 a 45 minutos.

La sensación de disparo vale tanto como las reglas. Cada impacto necesita marcador de acierto, sonido propio y el aviso de puntos ganados. Cada cambio de ronda necesita su sintonía y su silencio.

## Sistemas de juego

El juego de lanzamiento tiene trece sistemas; los nueve primeros de la tabla forman el núcleo y quedan completos en la fase 2. Cada uno conserva la regla del género y cambia la ficción.

Ambientación propuesta: la Estación Aurora, una base de investigación de montaña abandonada en los años sesenta. Los enemigos son «los Vacíos», cuerpos huecos que se deshacen en ceniza al caer. Esa ceniza resuelve tres cosas a la vez: evita la sangre, ahorra cadáveres en pantalla y da identidad visual.

| Sistema | Regla | Ficción propia |
| --- | --- | --- |
| Rondas | Cada ronda trae un número fijo de enemigos, más fuertes y rápidos. Pausa de 10 s entre rondas | Sirena de la estación al empezar y al acabar |
| Puntos | Se ganan por impacto, por baja y por reparar. Son la única moneda | Contador con el aviso de cada ganancia |
| Barricadas | Los enemigos entran por ventanas tapiadas que arrancan tablón a tablón. Repararlas da puntos, con tope por ronda | Planchas metálicas atornilladas |
| Puertas | Pagar abre una zona nueva y sus entradas de enemigos. No se pueden volver a cerrar | Compuertas con cerradura de pago |
| Armas de pared | Arma fija a precio fijo; recomprar munición cuesta la mitad | Taquillas de armería |
| Caja aleatoria | Pagas y recibes un arma al azar, incluidas las que no se venden. Tras varios usos se traslada a otro punto | «El Contenedor», una cápsula de suministros |
| Energía | Un interruptor en una zona lejana activa las ventajas y la mejora de armas | Generador general de la estación |
| Ventajas | Mejoras permanentes que se compran en puntos fijos. Máximo cuatro. Se pierden todas al caer | «Sueros» en estaciones médicas |
| Derribo y fin | Al quedarte sin vida caes y te desangras en 45 s. En solitario, un suero permite levantarte solo, tres veces por partida | Baliza de auxilio |
| Mejora de armas | Por un precio alto, el arma gana daño, cargador y un efecto. Requiere energía | «La Forja», en la torre de radio |
| Power-ups | Los enemigos sueltan a veces una bonificación de 30 s o inmediata | Munición completa, Baja instantánea, Puntos dobles, Onda expansiva |
| Ronda especial | Cada 5–7 rondas solo aparece un enemigo rápido y frágil. Al terminar suelta munición completa | «La Jauría» |
| Misión secreta | Cadena de 5 pasos ocultos por el mapa, con recompensa permanente para la partida | Reactivar la antena y enviar la señal |

Las cuatro ventajas de lanzamiento, con nombres provisionales:

- **Coraza** (2.500 puntos): duplica la vida.
- **Pulso** (3.000): recarga el doble de rápido.
- **Doble filo** (2.000): aumenta la cadencia de disparo.
- **Segundo aliento** (1.500): reanima más rápido; en solitario, te levanta solo.

Fuera del lanzamiento, por orden de llegada: cooperativo, consumibles previos a la partida, más ventajas, un jefe y un segundo mapa.

## Números y balance

La dificultad sale de tres curvas: la vida del enemigo, cuántos hay y cada cuánto aparecen. Son valores de partida para el prototipo; se ajustan con partidas reales, no en la hoja de cálculo.

Vida del enemigo en la ronda r: lineal hasta la 9, exponencial desde la 10.

```latex
H(r) = \begin{cases} 150 + 100\,(r-1) & r \le 9 \\ 950 \cdot 1{,}1^{\,r-9} & r \ge 10 \end{cases}
```

Enemigos por ronda en solitario. Cada jugador adicional suma un 50 %.

```latex
N(r) = \operatorname{round}\left(0{,}09\,r^{2} + 2{,}4\,r + 6\right)
```

Intervalo entre apariciones, con mínimo de 0,1 s.

```latex
S(r) = \max\left(0{,}1,\; 2 \cdot 0{,}95^{\,r-1}\right)
```

| Ronda | Vida del enemigo | Enemigos (solitario) | Intervalo de aparición (s) |
| --- | --- | --- | --- |
| 1 | 150 | 8 | 2,00 |
| 5 | 550 | 20 | 1,63 |
| 10 | 1.045 | 39 | 1,26 |
| 15 | 1.683 | 62 | 0,98 |
| 20 | 2.710 | 90 | 0,75 |
| 30 | 7.030 | 159 | 0,45 |

Reglas fijas que acompañan a las curvas:

- **Enemigos vivos a la vez:** 24 en solitario, 4 más por jugador adicional, tope de 32. El tope lo marca el rendimiento, y además crea el ritmo de la horda.
- **Velocidad:** el jugador anda a 4,5 m/s y esprinta a 6,5. Los enemigos andan a 1,5 en las rondas 1–3, corren a 4 desde la 4 y esprintan a 6 desde la 12. Siempre algo más lentos que tu esprint: eso permite rodearlos.
- **Vida del jugador:** 100 puntos. Cada golpe quita 45, así que el tercero derriba. Con Coraza son 200 y derriba el quinto. La vida se regenera tras 4 s sin recibir daño.
- **Daño a la cabeza:** multiplica por 2,5.

Economía de puntos:

| Concepto | Puntos |
| --- | --- |
| Impacto que no mata | +10 |
| Baja al cuerpo | +60 |
| Baja a la cabeza | +100 |
| Baja cuerpo a cuerpo | +130 |
| Reparar una plancha | +10 |
| Puertas | 750 a 1.500 |
| Armas de pared | 500 a 1.500 |
| El Contenedor | 950 |
| Sueros | 1.500 a 3.000 |
| La Forja | 5.000; repetir mejora, 2.500 |

El diseño empuja a un dilema conocido: disparar al cuerpo con armas débiles da más puntos por enemigo, pero cuesta más munición y más riesgo.

Arsenal de lanzamiento. Cada arma cubre un papel del arsenal de Black Ops 3 y se asigna al arma real que dispara de forma más parecida:

| Papel en BO3 (referencia) | Arma real | Nombre en el juego | Por qué encaja |
| --- | --- | --- | --- |
| Pistola inicial semiautomática (MR6) | Colt M1911 | M1911 | Un disparo por pulsación, cargador corto, retroceso seco |
| Escopeta de corredera (KRM-262) | Remington 870 | M870 | Un disparo por bombeo, retroceso fuerte, recarga cartucho a cartucho |
| Subfusil equilibrado (Kuda) | HK MP5 | SMG-5 | 800 disparos/min, retroceso bajo, ligera |
| Subfusil de cadencia extrema (Vesper) | KRISS Vector | V-45 | 1.200 disparos/min: vacía el cargador en segundo y medio |
| Fusil de asalto equilibrado (KN-44) | AK-74 | AK-74 | 650 disparos/min, retroceso medio, buen daño |
| Fusil de ráfagas (M8A7) | M16A4 | M16 | Ráfagas de 3, muy preciso, exige apuntar |
| Fusil pesado de cadencia lenta (Man-O-War) | FN SCAR-H | Mk 17 | Calibre 7,62: pega fuerte, dispara lento, retroceso alto |
| Ametralladora ligera (Dingo, BRM) | FN M249 | M249 | Cinta de 100, cadencia alta, pesada y lenta de recargar |
| Fusil de precisión semiautomático (Drakon) | SVD Dragunov | SVD | 10 balas sin accionar cerrojo; atraviesa enemigos en fila |
| Arma especial (Ray Gun) | Ninguna | Arco voltaico | El arma especial del género es ficción por definición |

Tres rasgos definen cómo se siente cada arma, y los tres salen del arma real: la cadencia es la real, el retroceso sigue al calibre y la movilidad sigue al peso. El daño no se copia de la realidad: se ajusta para el balance.

| Arma | Dónde y coste | Daño por bala | Cadencia (disparos/min) | Cargador | Retroceso | Movilidad |
| --- | --- | --- | --- | --- | --- | --- |
| M1911 | Inicial | 20 | Semiautomática | 8 | Medio | 100 % |
| M870 | Pared, vestíbulo · 500 | 8 × 30 | 70 | 6 | Alto | 95 % |
| SMG-5 | Pared, vestíbulo · 750 | 28 | 800 | 30 | Bajo | 100 % |
| V-45 | Pared, laboratorio · 1.000 | 24 | 1.200 | 30 | Alto | 100 % |
| AK-74 | Pared, almacén · 1.250 | 45 | 650 | 30 | Medio | 95 % |
| M16 | Pared, patio · 1.500 | 60 | Ráfaga de 3 | 30 | Bajo | 95 % |
| Mk 17 | Contenedor · 950 | 70 | 550 | 20 | Alto | 90 % |
| M249 | Contenedor · 950 | 50 | 800 | 100 | Medio | 85 % |
| SVD | Contenedor · 950 | 300 | Semiautomática | 10 | Muy alto | 90 % |
| Arco voltaico | Contenedor · 950 | Daño en cadena a 5 enemigos | 90 | 12 | Nulo | 95 % |

La movilidad es el porcentaje de la velocidad base del jugador con el arma en la mano.

El mismo criterio sirve para ampliar el arsenal después del lanzamiento:

| Papel en BO3 (referencia) | Arma real | Rasgo que hereda |
| --- | --- | --- |
| Subfusil de cargador grande (Weevil) | FN P90 | 50 balas, 900 disparos/min, muy manejable |
| Subfusil lento y estable (Razorback) | HK UMP45 | 600 disparos/min, casi sin retroceso |
| Pistola automática (L-CAR 9) | Glock 18 | 1.200 disparos/min, difícil de controlar |
| Pistola de ráfagas (RK5) | Beretta 93R | Ráfagas de 3 |
| Fusil rápido de poco daño (HVK-30) | M4A1 | Ligera, hasta 900 disparos/min |
| Fusil preciso de retroceso mínimo (ICR-1) | Steyr AUG | Estable, cadencia media |
| Fusil semiautomático (Sheiva) | M14 | Un disparo potente por pulsación |
| Escopeta semiautomática (205 Brecci) | Benelli M4 | Dispara tan rápido como pulses |
| Escopeta automática (Haymaker 12) | AA-12 | 300 disparos/min, tambor de 20 |
| Ametralladora lenta y demoledora (Gorgon) | M60 | 550 disparos/min, retroceso muy alto |
| Fusil de cerrojo (Locus) | Remington 700 | Un disparo y recarga manual |

Representar armas reales es práctica habitual en los videojuegos. El riesgo está en las marcas: el nombre comercial y el logotipo del fabricante. Por eso el nombre en el juego es la designación militar o un nombre genérico, y los modelos no llevan grabados de fabricante.

Todos los valores viven en un único archivo de datos, no en el código. Así se ajusta el balance sin tocar la lógica.

## Diseño del mapa de lanzamiento

El mapa es la Estación Aurora: seis zonas unidas por siete puertas de pago que forman dos circuitos cerrados. Abrirlo entero cuesta 7.500 puntos; llegar a la energía por el camino más corto, 1.750.

Conexiones entre zonas (cada conexión es una puerta de pago):

| Puerta | Une | Coste |
| --- | --- | --- |
| 1 | Vestíbulo (inicio) ↔ Laboratorio | 750 |
| 2 | Vestíbulo (inicio) ↔ Almacén | 750 |
| 3 | Laboratorio ↔ Sala de energía | 1.000 |
| 4 | Almacén ↔ Patio exterior | 1.000 |
| 5 | Laboratorio ↔ Patio exterior | 1.250 |
| 6 | Sala de energía ↔ Torre de radio | 1.250 |
| 7 | Patio exterior ↔ Torre de radio | 1.500 |

Disposición en cuadrícula de 3 × 2: fila superior Vestíbulo, Laboratorio, Sala de energía; fila inferior Almacén, Patio exterior, Torre de radio.

El circuito izquierdo une vestíbulo, laboratorio, patio y almacén. El derecho une laboratorio, sala de energía, torre y patio.

Los circuitos son la decisión de diseño más importante. Un jugador perseguido necesita poder correr en círculo sin toparse con un callejón sin salida. Cada circuito debe poder recorrerse en 15–25 segundos.

Qué hay en cada zona:

- **Vestíbulo:** sala inicial, pequeña y con cuatro ventanas. Escopeta y subfusil ligero de pared. Suero Segundo aliento.
- **Laboratorio:** pasillos estrechos, peligroso. Suero Coraza y subfusil V-45.
- **Almacén:** primera posición de El Contenedor y fusil de asalto de pared.
- **Patio exterior:** el espacio más amplio, pensado para mover la horda. Fusil de ráfagas y suero Pulso.
- **Sala de energía:** el interruptor general y el suero Doble filo.
- **Torre de radio:** La Forja y el final de la misión secreta.

Reglas de construcción del nivel:

1. Cada zona tiene de dos a cuatro entradas de enemigos, visibles desde su centro.
2. Ninguna compra importante está a menos de una puerta del inicio, salvo las dos armas básicas y el suero Segundo aliento.
3. El Contenedor tiene cuatro posiciones posibles, una por zona no inicial salvo la sala de energía.
4. La geometría es modular: piezas de 4 × 4 m que encajan. Un mapa nuevo se monta con las mismas piezas.
5. El nivel se prueba primero en cajas grises. No se hace arte hasta que el flujo divierte.

Ritmo esperado de una partida media: energía encendida en las rondas 5–7, primera mejora en La Forja en las rondas 10–12, mapa abierto del todo hacia la 12.

## Arquitectura técnica

La regla que ordena todo el código: la simulación del juego es un módulo de TypeScript puro, sin gráficos ni navegador, que avanza a 60 pasos fijos por segundo. El render, el audio y la interfaz solo leen su estado. Ese mismo módulo correrá después en el servidor del cooperativo.

| Capa | Elección | Por qué |
| --- | --- | --- |
| Lenguaje y build | TypeScript + Vite | Tipos compartidos entre cliente y servidor; builds pequeños y recarga instantánea |
| Render | [Three.js](https://www.utsubo.com/blog/webgpu-threejs-migration-guide) con `WebGPURenderer` | Usa WebGPU donde existe y cae a WebGL 2 de forma automática, con un solo código |
| Física y colisiones | Rapier (WebAssembly) | Controlador de personaje y trazado de rayos integrados; se inicializa de forma asíncrona |
| Navegación de enemigos | Malla de navegación precalculada (recast-navigation-js) con agentes de multitud | Los enemigos se esquivan entre sí y rodean obstáculos sin calcular rutas uno a uno |
| Disparos | Rayo instantáneo contra cápsulas de impacto (cabeza, torso, extremidades) | Barato, exacto y fácil de validar en servidor |
| Audio | Web Audio API con sonido posicional | Oír por dónde llega el enemigo es parte del juego |
| Interfaz | HTML y CSS sobre el canvas | Texto nítido a cualquier tamaño y casi sin coste |
| Datos de balance | Archivos JSON validados con tipos | Ajustar sin recompilar la lógica |
| Guardado | Almacenamiento local, siempre dentro de `try/catch` | El modo incógnito y algunos portales lo bloquean |
| Pruebas | Vitest sobre la simulación | La lógica de rondas y puntos se prueba sin abrir el navegador |

Sobre el renderizador hay una decisión abierta que se cierra al final del prototipo. Three.js ofrece WebGPU sin configuración desde la versión r171, y la actual es la r187. Su manual sigue describiendo `WebGPURenderer` como experimental, y hay escenas que rinden mejor con el `WebGLRenderer` clásico. La compatibilidad global con WebGPU ronda el 87 %; Firefox en Linux y Android aún no lo trae.

Por eso el prototipo mide los dos caminos en el equipo objetivo más modesto. Mientras tanto, una regla mantiene ambos abiertos: nada de sombreadores GLSL a medida. Solo materiales integrados o nodos TSL.

Presupuestos que el juego no puede superar:

| Recurso | Límite |
| --- | --- |
| Fotogramas | 60 por segundo en un portátil con gráfica integrada a 1080p; 30 en un Chromebook de 4 GB con calidad baja |
| Llamadas de dibujo | 150 por fotograma |
| Triángulos visibles | 300.000 |
| Enemigo | 3.000–5.000 triángulos y 30 huesos como máximo |
| Descarga hasta poder jugar | 15 MB |
| Descarga total | 60 MB, con carga diferida del resto |
| Memoria | 1 GB en la pestaña |

Cuatro decisiones de implementación que evitan los problemas habituales:

1. **Paso fijo con interpolación.** La simulación va a 60 Hz aunque el monitor vaya a 144. CrazyGames exige física consistente a distintas tasas de refresco.
2. **Resolución dinámica.** Si los fotogramas caen, baja la resolución interna antes que la calidad de juego.
3. **Reutilización de objetos.** Enemigos, casquillos, partículas y números flotantes salen de reservas fijas. Crear y destruir objetos en plena horda provoca tirones.
4. **Controles sin atajos del navegador.** No asignes nada a Ctrl: Ctrl + W cierra la pestaña. Escape libera el ratón, así que Escape es siempre el menú de pausa.

Estructura del repositorio: `shared/` con la simulación y los datos, `client/` con render, audio, entrada e interfaz, y `server/` vacío hasta la fase cooperativa.

## Multijugador cooperativo

El cooperativo usa un servidor autoritativo con salas de hasta cuatro jugadores, construido sobre [Colyseus](https://colyseus.io/pricing). El servidor ejecuta la misma simulación del módulo `shared/` y decide todo lo que importa: enemigos, puntos, compras y rondas.

Colyseus es de código abierto y se puede alojar gratis en un servidor propio. Su alojamiento gestionado, Colyseus Cloud, parte de 15 $ al mes sin límite de jugadores simultáneos.

Quién decide cada cosa:

| Elemento | Autoridad | Cómo se ve fluido |
| --- | --- | --- |
| Tu movimiento | Cliente, con validación de velocidad en el servidor | Respuesta inmediata, sin esperar a la red |
| Tus disparos | El cliente calcula el impacto; el servidor comprueba que era posible | El marcador de acierto aparece al instante |
| Enemigos | Servidor | El cliente interpola entre estados con 100 ms de retraso |
| Puntos, compras, puertas, rondas | Servidor | Confirmación en menos de un parpadeo; el sonido de compra espera a la confirmación |
| Otros jugadores | Servidor reenvía su estado | Interpolación |

En un juego cooperativo contra la máquina las trampas solo dañan las clasificaciones. Por eso se permite que el cliente calcule sus impactos, algo impensable en un competitivo, y se ahorra la parte más cara del código de red.

Decisiones de producto del cooperativo:

- **Entrar a jugar:** partida privada con enlace de invitación y partida rápida pública. Quien abre el juego entra directo a una sala propia a la que sus amigos pueden unirse.
- **Unirse a media partida:** se entra como espectador y se aparece al empezar la ronda siguiente.
- **Desconexiones:** el personaje queda 60 s en pie sin actuar; después desaparece y la dificultad se recalcula.
- **Comunicación:** sin chat de texto. Marcadores sobre el mapa y cuatro mensajes rápidos. Un chat obliga a moderación.
- **Continuidad:** al terminar, el grupo puede repetir en la misma sala sin volver al menú.
- **Regiones:** una sola en Europa al lanzar; la segunda se abre cuando los datos lo pidan.

Estas decisiones coinciden con lo que [CrazyGames pide a los juegos multijugador](https://docs.crazygames.com/requirements/multiplayer/): sala compartible, entrada instantánea, mantener el grupo entre partidas y moderación si hay chat.

Coste estimado, a confirmar con una prueba de carga en la fase 4: un servidor privado virtual de 5–20 € al mes debería sostener decenas de salas, porque cada sala simula como mucho 32 enemigos y envía 20 actualizaciones por segundo.

Descartado: conexión directa entre jugadores con uno de ellos como anfitrión. No cuesta servidor, pero falla tras muchos routers domésticos y la partida muere si el anfitrión se va.

## Arte, animación, audio e interfaz

La dirección artística es estilizada y de pocos polígonos, con mucha niebla y luz dura. No intenta imitar el realismo del original. Es la estética que los generadores de 3D producen hoy con más consistencia, pesa poco y no se parece a la obra de nadie.

### Arte y animación

- **Escenario:** kit modular de unas 40 piezas (suelos, muros, puertas, ventanas, mobiliario) con una sola textura de paleta compartida. Menos materiales significa menos llamadas de dibujo.
- **Enemigos:** un modelo base con tres variantes de ropa y color. Ocho animaciones: andar, correr, esprintar, atacar, recibir impacto, trepar ventana, caer y deshacerse.
- **Armas en primera persona:** lo más caro de animar. Para el lanzamiento, arma sin brazos visibles y animada por código: balanceo, retroceso, recarga y cambio. Los brazos animados a mano quedan para después.
- **Muerte del enemigo:** se deshace en ceniza con un efecto de partículas y desaparece. Sin sangre, sin desmembramientos y sin cadáveres.
- **Iluminación:** luz precalculada en el escenario y pocas luces dinámicas (fogonazo, linterna, power-ups). Las sombras en tiempo real son un lujo que se activa solo en calidad alta.

Flujo de producción de un asset: generar con IA → limpiar y reducir la malla en Blender → exportar a glTF → comprimir malla y texturas → comprobar peso y triángulos → entrar al juego. El paso de compresión se automatiza en el build.

De dónde salen los assets: todos se generan con IA. Las armas, a partir de fotos de referencia del arma real, sin marcas ni grabados. Enemigos, máquinas y escenario, a partir de arte conceptual propio. Si algún modelo se descarga en vez de generarse, necesita licencia de uso comercial. Apunta en una hoja la herramienta y las condiciones de uso de cada asset: los portales pueden pedirlas.

### Audio

El audio transmite la mitad de la esencia. Lista mínima:

- Sirena de inicio y de fin de ronda, propias y reconocibles.
- Un disparo, una recarga y un sonido de «sin munición» por arma.
- Voces de enemigo posicionales: lejos, cerca, atacando, por la espalda.
- Sonido de punto ganado, de compra y de compra denegada.
- Voz que anuncia cada power-up.
- Melodía corta por suero y música ambiental que sube con la ronda.

El navegador no deja sonar nada hasta el primer clic del jugador. El audio se inicia al pulsar «Jugar».

### Interfaz

La interfaz en partida muestra siete cosas, con una disposición propia y distinta de la del original: ronda, puntos con sus ganancias flotantes, munición, sueros activos, temporizador de power-ups, aviso de interacción con su precio y marcador de acierto.

Tres requisitos de los portales que condicionan el diseño:

- Todo debe leerse en un marco de [821 × 462 píxeles](https://docs.crazygames.com/requirements/gameplay/), el más pequeño de CrazyGames en escritorio.
- El inglés es obligatorio. El juego sale en inglés y español, con los textos en archivos de idioma desde el primer día.
- El jugador nuevo debe estar jugando con un clic como máximo. Menú principal de un solo botón, tutorial dentro de la primera ronda.

El tutorial son cuatro avisos contextuales: dispara, repara la ventana, compra el arma de la pared, abre la puerta. Nada de pantallas de texto.

## Hoja de ruta de producción

Son siete fases y 46 semanas, a unas 10–12 horas semanales. Cada fase termina en un criterio de salida comprobable: si no se cumple, la fase no se cierra y no se empieza la siguiente.

Calendario de fases:

| Fase | Inicio | Fin |
| --- | --- | --- |
| 0 · Preproducción | 2026-11-16 | 2026-11-29 |
| 1 · Prototipo gris | 2026-11-30 | 2027-01-10 |
| 2 · Vertical slice | 2027-01-11 | 2027-03-07 |
| 3 · Alfa en solitario | 2027-03-08 | 2027-05-16 |
| Lanzamiento en solitario | 2027-05-17 | 2027-05-17 |
| 4 · Cooperativo | 2027-05-17 | 2027-07-25 |
| 5 · Beta y pulido | 2027-07-26 | 2027-09-05 |
| 6 · Lanzamiento | 2027-09-06 | 2027-10-03 |
| Lanzamiento cooperativo | 2027-09-20 | 2027-09-20 |

El cooperativo ocupa una fase entera y llega cuando el juego en solitario ya está publicado y probado por jugadores reales.

| Fase | Qué se construye | Criterio de salida |
| --- | --- | --- |
| 0 · Preproducción | Repositorio, build, despliegue automático a un dominio de pruebas, este documento cerrado | Un cubo girando publicado en una URL, desplegado con un solo comando |
| 1 · Prototipo gris | Control en primera persona, una sala, enemigos que entran por ventanas, rondas, puntos, un arma de pared, una puerta | Diez minutos divertidos en cajas grises. 60 fotogramas con 24 enemigos. Renderizador decidido |
| 2 · Vertical slice | Todos los sistemas del núcleo en dos zonas, una con arte final: Contenedor, dos sueros, energía, Forja, power-ups, derribo, interfaz, audio | Cinco personas ajenas al proyecto juegan 20 minutos sin explicación y piden otra partida |
| 3 · Alfa en solitario | Mapa completo, 10 armas, 4 sueros, ronda especial, misión secreta, menús, ajustes, guardado, inglés y español | Versión pública publicada. Sin errores que bloqueen la partida en 30 rondas |
| 4 · Cooperativo | Servidor, salas, sincronización, reanimación entre jugadores, invitaciones, partida rápida | Cuatro jugadores completan 30 minutos con 150 ms de latencia sin desincronización visible |
| 5 · Beta y pulido | Rendimiento, balance, integración del SDK de anuncios, portada y tráiler, corrección de errores | Cumple la lista de requisitos de lanzamiento completo de CrazyGames. Carga inicial por debajo de 15 MB |
| 6 · Lanzamiento | Publicación en portales, comunidad, seguimiento de métricas, parches | Juego publicado y primer parche entregado |

Tres reglas para que el calendario aguante:

- **Lo jugable manda.** Al final de cada semana hay una versión que arranca y se puede jugar, aunque tenga menos cosas.
- **El alcance se recorta, la fecha no.** Si una fase se alarga más de un 25 %, se quita contenido de la lista de lanzamiento. Orden de recorte: misión secreta, ronda especial, armas 8 a 10, cuarto suero.
- **El lanzamiento en solitario es real.** No es una demo interna: es un juego completo, público y que ya recibe jugadores y comentarios mientras se construye la red.

## Pruebas, rendimiento y calidad

La calidad se mide con tres tipos de prueba: automática sobre la lógica, de rendimiento sobre equipos reales y de juego con personas. Las tres empiezan en el prototipo, no en la beta.

### Pruebas automáticas

- Pruebas unitarias de la simulación: curvas de ronda, puntos por cada tipo de baja, compras con saldo insuficiente, límite de sueros, traslado de El Contenedor.
- Un jugador automático que juega 30 rondas sin gráficos en cada cambio de código. Detecta bloqueos: enemigos atascados, rondas que no terminan, puntos negativos.
- Comprobación del tamaño del build en cada despliegue, con fallo si supera el presupuesto.

### Rendimiento

Equipos y navegadores de prueba, por orden de importancia:

| Equipo | Navegador | Qué valida |
| --- | --- | --- |
| Portátil con gráfica integrada | Chrome y Edge | El objetivo principal: 60 fotogramas |
| Chromebook de 4 GB | Chrome | El mínimo. CrazyGames desactiva en ChromeOS los juegos que no van fluidos ahí |
| Mac | Safari | CrazyGames desactiva en Safari los juegos que fallan en él |
| Cualquiera | Firefox | Un segundo motor de navegador; el camino WebGL 2 se fuerza con una opción del renderizador |
| Monitor de 144 Hz | Chrome | Que la velocidad del juego no dependa de la tasa de refresco |

En cada sesión se anotan cuatro cifras en la ronda 15 con 24 enemigos vivos: fotogramas medios, el 1 % de fotogramas más lentos, memoria de la pestaña y segundos desde abrir la página hasta poder disparar.

### Pruebas con jugadores

Cinco personas por hito bastan para encontrar los problemas graves. El método: mirar en silencio, no explicar nada y apuntar dónde dudan.

Preguntas que cada tanda debe responder:

- ¿Entienden sin ayuda que los puntos compran cosas? ¿Cuánto tardan en hacer la primera compra?
- ¿En qué ronda caen y por qué creen que cayeron? Si culpan al juego y no a sí mismos, hay un problema de claridad.
- ¿Piden otra partida?

Desde el lanzamiento en solitario, el juego registra de forma anónima la ronda alcanzada, la duración de la sesión, la causa del derribo y las compras por ronda. Con eso se ajusta el balance.

## Lanzamiento, distribución y monetización

El juego se publica en tres sitios por este orden: itch.io para los primeros jugadores, dominio propio como casa del proyecto y CrazyGames para el tráfico y los ingresos. Poki queda fuera del lanzamiento porque exige que el juego funcione en móvil y tableta.

| Canal | Papel | Requisitos que afectan al diseño | Ingresos |
| --- | --- | --- | --- |
| itch.io | Primer enlace público y comentarios, desde la alfa | Subir un ZIP con `index.html` | Donaciones opcionales |
| Dominio propio | Casa del juego, comunidad y versión sin intermediarios | Alojamiento estático; política de privacidad y aviso de cookies si hay analítica | Ninguno al principio |
| [CrazyGames](https://docs.crazygames.com/requirements/intro/) | Tráfico e ingresos | Descarga inicial ≤ 50 MB, total ≤ 250 MB, ≤ 1.500 archivos, apto para PEGI 12, inglés, Chrome y Edge, sin anuncios ajenos | Reparto de ingresos publicitarios, solo en lanzamiento completo |
| [Poki](https://sdk.poki.com/requirements) | Objetivo posterior, si se hace versión móvil | Móvil y tableta obligatorios, formato 16:9, sin peticiones a servidores externos salvo multijugador con política de privacidad | 100 % de los ingresos del tráfico que tú traes; reparto a medias en el que trae Poki |

CrazyGames publica en dos pasos, y el plan los aprovecha. El lanzamiento básico no exige su SDK ni permite anuncios: sirve para probar el juego con una audiencia limitada. Si los datos son buenos, pasa a lanzamiento completo, con SDK, anuncios e ingresos. La alfa en solitario entra al lanzamiento básico; la beta se prepara para el completo.

### Monetización

El juego es gratuito y los anuncios nunca interrumpen una ronda. Tres formatos, de menos a más intrusivo:

1. **Anuncio recompensado y voluntario:** una reanimación extra por partida, o repetir una tirada de El Contenedor. Uno por partida, para no romper el balance.
2. **Anuncio al terminar la partida,** antes de la siguiente.
3. **Banner** solo en el menú.

No se vende ventaja de juego. Más adelante, si hay comunidad: aspectos de armas y de personaje.

### Comunicación

- **Desde la fase 1:** un vídeo corto por semana del desarrollo. Los clips de hordas funcionan solos.
- **Desde la alfa:** servidor de Discord enlazado desde el menú, donde se recogen errores y se anuncian parches.
- **Para el lanzamiento:** tráiler de 30–45 segundos, portadas en los formatos de cada portal y una página propia con el juego incrustado.
- **Siempre:** describe el género, no nombres la marca del original.

### Después de lanzar

El primer mes, un parche por semana con los errores y el balance que revelen los datos. Después, contenido cada cuatro a seis semanas en este orden: sueros nuevos, armas nuevas, consumibles previos a la partida, jefe, segundo mapa.

Indicadores que decidirán si merece la pena seguir invirtiendo, con objetivos iniciales propios:

| Indicador | Objetivo |
| --- | --- |
| Jugadores que llegan a disparar tras abrir la página | 70 % |
| Duración media de la sesión | 12 minutos |
| Jugadores que vuelven al día siguiente | 15 % |
| Ronda media alcanzada | 8 |

## Riesgos y primeros pasos

El mayor riesgo del proyecto no es técnico: es que una persona sola abandone un plan de 11 meses. Por eso el plan pone algo jugable y público pronto, y deja lo más difícil para cuando ya hay jugadores.

| Riesgo | Señal de alarma | Respuesta |
| --- | --- | --- |
| El alcance crece | Aparecen sistemas que no están en este documento | Lista de «después del lanzamiento»; nada entra sin sacar otra cosa |
| El código generado por IA se vuelve frágil | Cada cambio rompe algo que ya funcionaba | Módulos pequeños, pruebas automáticas que deben pasar antes de aceptar un cambio y este documento como contexto fijo de cada sesión |
| El cooperativo se come el proyecto | La fase 4 supera las 12 semanas | Lanzar el cooperativo solo con partidas privadas por enlace; la partida rápida llega en un parche |
| No rinde con 24 enemigos animados | Menos de 60 fotogramas en el prototipo | Bajar huesos y triángulos, animar a media frecuencia a los lejanos, reducir el tope a 18 |
| Las animaciones en primera persona atascan el arte | Más de dos semanas en un arma | Mantener las armas animadas por código en el lanzamiento |
| Parecido excesivo con el original | Un tester dice «es igual que…» sobre algo visual o sonoro | Cambiar esa presentación; las reglas no se tocan |
| Un portal rechaza el juego | Fallo en la revisión de contenido o de tamaño | Presupuestos de descarga y criterio PEGI 12 vigilados desde el prototipo |
| El juego no divierte | Los testers de la fase 2 no piden otra partida | Parar el contenido y arreglar la sensación de disparo y el ritmo antes de seguir |

Coste estimado hasta el lanzamiento, a confirmar: dominio, unos 15 € al año; alojamiento estático, gratuito en los planes básicos habituales; servidor de juego desde la fase 4, 5–20 € al mes; assets y sonido con licencia, hasta 300 €.

### Las dos primeras semanas

- [x] Decidir el nombre definitivo y comprobar que no existe como marca ni como juego.
- [x] Crear el repositorio con las carpetas `shared/`, `client/` y `server/`, TypeScript y Vite.
- [x] Montar el despliegue automático a un dominio de pruebas con HTTPS. WebGPU solo funciona en contexto seguro.
- [ ] Poner en pantalla una sala de cajas grises con control en primera persona y captura de ratón.
- [ ] Integrar Rapier: colisión con muros y un disparo por rayo que marque el impacto.
- [x] Escribir el archivo de datos con las curvas de ronda y sus pruebas unitarias.
- [ ] Jugar dos horas al género tomando notas de ritmo: cuánto dura cada ronda, cuándo se compra, cuándo se cae.
- [x] Abrir la hoja de licencias de assets y la lista de «después del lanzamiento».

## Fuentes

Datos de plataformas y tecnología consultados el 9 de noviembre de 2026:

- [CrazyGames: requisitos generales](https://docs.crazygames.com/requirements/intro/), [técnicos](https://docs.crazygames.com/requirements/technical/), [de juego](https://docs.crazygames.com/requirements/gameplay/) y [de multijugador](https://docs.crazygames.com/requirements/multiplayer/)
- [Poki: requisitos para juegos](https://sdk.poki.com/requirements) y [guía para desarrolladores](https://sdk.poki.com/)
- [Colyseus: precios](https://colyseus.io/pricing)
- [Utsubo: guía de migración de Three.js a WebGPU](https://www.utsubo.com/blog/webgpu-threejs-migration-guide), para versiones de Three.js, compatibilidad de navegadores y comportamiento del renderizador

Las curvas de balance, los precios, los presupuestos de rendimiento, el calendario y los costes son propuestas de este plan, no datos de terceros.
