# Política de privacidad

Última actualización: 28 de septiembre de 2026

Esta política explica qué información recoge Guildbook, por qué, quién puede verla y qué opciones tienes. Cubre guildbook.io, cada sitio de hermandad en un subdominio de guildbook.io (por ejemplo osm.guildbook.io), los dominios propios que las hermandades conectan a Guildbook y la app complementaria Vigil. Guildbook lo gestiona Matthew Rosendin ("nosotros"), que es el responsable del tratamiento de los datos del servicio.

Guildbook es gratuito y sin ánimo de lucro. **No vendemos tus datos, no mostramos anuncios y no usamos herramientas de analítica ni de seguimiento.**

## En resumen

- Inicias sesión con Discord. Recibimos tu ID de Discord, tu nombre de usuario, tu nombre visible, tu avatar y tu dirección de correo.
- Vincular Battle.net es opcional. Si lo haces, guardamos el ID de tu cuenta de Battle.net, tu BattleTag y una instantánea de tu lista de personajes. El token de acceso de Battle.net se guarda cifrado y caduca al cabo de un día aproximadamente.
- Las hermandades guardan lo que tú les das: tus personajes, tus solicitudes y tu rango. La plantilla y las páginas de personajes son públicas. Las solicitudes y el registro de auditoría solo los ven los oficiales de esa hermandad.
- Vigil analiza tu registro de combate en tu propio ordenador. Solo se suben resúmenes por combate, son privados por defecto y tú eliges quién los ve.

## Información que recogemos

### Cuando inicias sesión con Discord

Pedimos a Discord los permisos `identify` y `email`. De Discord recibimos y guardamos:

- tu ID de usuario de Discord;
- tu nombre de usuario y tu nombre visible de Discord;
- un enlace a tu avatar de Discord;
- tu dirección de correo, y si Discord indica que está verificada.

**No guardamos los tokens de acceso ni de actualización de Discord.** Discord los emite cuando inicias sesión y los descartamos de inmediato; solo conservamos tu ID de usuario de Discord y los permisos que concediste. Nunca llamamos a Discord en tu nombre.

No recibimos tu contraseña de Discord, tus servidores, tu lista de amigos ni tus mensajes.

### Cuando vinculas Battle.net (opcional)

Vincular Battle.net te permite demostrar que tus personajes son realmente tuyos. A Blizzard solo le pedimos el permiso `wow.profile`. Guardamos:

- el ID de tu cuenta de Battle.net, tu BattleTag y tu región;
- una instantánea de los personajes de World of Warcraft de tu cuenta, en las regiones de América y Europa: ID del personaje, nombre, apellido, región, reino, nivel, clase, raza, facción y nombre de la hermandad;
- cuándo se tomó la instantánea y si estaba completa;
- el token de acceso de Battle.net, **cifrado en reposo** (AES-256-GCM). Blizzard no emite un token de actualización, así que este token deja de funcionar al cabo de unas 24 horas y después no podemos usarlo.

Battle.net nunca se usa para iniciar sesión.

### Pertenencia a hermandades y personajes

Cuando te unes a una hermandad o envías una solicitud, esa hermandad guarda:

- tu estado de pertenencia (aspirante, activo o antiguo), tu rango y las fechas en que entraste y saliste;
- tus personajes: nombre, apellido, facción, clase, especialización, rol, nivel, reino, cuál es tu principal, profesiones y niveles de habilidad, y si el personaje está verificado con Battle.net;
- en los personajes verificados, el ID de personaje de Blizzard y cuándo se sincronizó por última vez.

Una vez al día, y siempre que lo pida un oficial, Guildbook comprueba los personajes verificados con los perfiles públicos de personaje de Blizzard para actualizar su nivel y su clase. Para ello usa las credenciales de la aplicación de Blizzard del propio Guildbook, no el token de tu cuenta. **Si desvinculas Battle.net, la sincronización se detiene:** tus personajes siguen en la plantilla pero se marcan como no verificados, y olvidamos sus ID de personaje de Blizzard.

### Solicitudes

Cuando envías una solicitud a una hermandad, guardamos tus respuestas:

- el personaje con el que te presentas (nombre, apellido, facción, clase, especialización, rol y nivel);
- tus respuestas de texto libre sobre experiencia en bandas, disponibilidad y por qué quieres unirte;
- tu usuario de Discord;
- tu aceptación del reglamento de la hermandad;
- si tu personaje está verificado, su ID de personaje de Blizzard, su reino, tu BattleTag y la hora de la instantánea utilizada;
- el estado de la solicitud, qué oficial la revisó, cuándo, y cualquier nota sobre la decisión que escribiera.

### Contenido y actividad de la hermandad

Los líderes de la hermandad crean contenido como páginas de la hermandad (con un historial de cada edición y de quién la hizo), horarios de banda, necesidades de reclutamiento, muertes de jefes (con un código de informe de Warcraft Logs y una nota opcionales, y quién las registró) y listados de addons. Una hermandad también puede guardar el ID y el enlace de invitación de su servidor de Discord, los dominios propios que ha conectado y si aparece en el directorio público de Guildbook. Registramos qué usuario creó cada hermandad.

### Registro de auditoría

Cada hermandad tiene un registro de auditoría de las acciones importantes, como el envío y la retirada de solicitudes, los cambios de rango, las expulsiones de miembros, las ediciones de contenido, los cambios de personajes, la vinculación y desvinculación de Battle.net, los cambios en la visibilidad de Vigil y el borrado de informes de Vigil. Cada entrada registra quién actuó, qué hizo, a qué afectó y los valores antes y después del cambio. Las entradas de auditoría registran nombres de personajes pero no tu BattleTag. El registro no se puede editar ni borrar de forma selectiva, para que la hermandad tenga un registro fiable de lo ocurrido. Las únicas excepciones son las descritas en "Cuánto tiempo los conservamos": cuando se borra una cuenta, o se elimina una solicitud antigua, las entradas se mantienen pero la identidad de la persona en ellas se sustituye por «Usuario eliminado». Subir un informe de Vigil no se registra a propósito, para que un informe privado no deje ningún rastro que puedan ver los oficiales.

### Resúmenes de combate de Vigil

Vigil trabaja con el archivo de registro de combate que World of Warcraft escribe en tu ordenador.

- **Tu registro de combate nunca sale de tu ordenador.** Se lee y se analiza localmente, en tu navegador o en la app complementaria.
- Solo se envía a Guildbook un **resumen de cada combate que decidas subir**. Un resumen trata de tu propio personaje: el nombre y el tipo del combate, el encuentro, los enemigos implicados y el daño que recibieron, el nombre, el ID en el juego y el nivel de tu personaje, tus totales de daño, sanación y amenaza, una cronología de tus lanzamientos, estadísticas de hechizos, tiempos activos de beneficios, uso de recursos, análisis de tiempos de reutilización y de rotación, y una puntuación. Si decides incluir el archivo de instantánea del addon Vigil, el resumen también puede incluir el equipo y los talentos de tu personaje.
- Los resúmenes no incluyen el rendimiento de otros jugadores.
- Los resúmenes son **privados por defecto**. Puedes compartir cada uno con los oficiales de tu hermandad o con toda la hermandad, y puedes fijar tu propio valor predeterminado. Los informes compartidos dejan de ser visibles para los demás si dejas la hermandad.
- Puedes borrar cualquiera de tus informes en cualquier momento.

### La app complementaria Vigil

- La app complementaria solo lee el archivo `WoWCombatLog*.txt` más reciente de la carpeta Logs de World of Warcraft que le indiques. Si se lo pides, copia el addon Vigil en la carpeta AddOns del juego. No lee otros archivos y nunca lee el juego en ejecución ni interactúa con él.
- Para emparejarla, obtienes un código de corta duración en el sitio de tu hermandad. Solo guardamos un **hash** del código.
- Un dispositivo emparejado recibe un token. En tu ordenador se guarda en el almacenamiento seguro de tu sistema operativo (Llavero en macOS, DPAPI en Windows) cuando está disponible. En nuestro lado solo guardamos un **hash SHA-256** del token, además del nombre del dispositivo, los últimos caracteres del token (para que puedas distinguir los dispositivos), cuándo se creó y se usó por última vez, si se ha revocado y un contador de subidas por minuto que se usa para limitar el ritmo.
- Puedes revocar un dispositivo en cualquier momento desde el sitio de tu hermandad.
- La app complementaria no contiene analítica ni seguimiento. Solo se comunica con el sitio de Guildbook con el que la emparejaste.

### Solicitudes de soporte

Cuando envías una solicitud de soporte desde guildbook.io/support, guardamos su categoría, su asunto y su mensaje, la hermandad que elegiste (si la hay), el correo de respuesta que indicaste (si lo hay) y datos que nos ayudan a responder: tu ID de usuario, tu nombre de Discord, la página de la que venías, el agente de usuario de tu navegador y la versión del sitio. Enviamos una copia por correo al operador de Guildbook para poder responder.

### Información técnica

Como en cualquier sitio web, nuestro proveedor de alojamiento recibe tu dirección IP, los datos de tu navegador y las páginas que solicitas cuando nos visitas. Usamos las direcciones IP brevemente, en memoria, para limitar el tráfico abusivo; no las guardamos en nuestra base de datos. Nuestro proveedor puede conservar registros de peticiones y de errores durante un periodo corto, normalmente de una hora a unos pocos días según nuestro plan de alojamiento, antes de que se borren automáticamente.

## Por qué usamos tu información y nuestras bases legales

Si estás en el Espacio Económico Europeo, el Reino Unido o una jurisdicción similar, estas son las bases legales en las que nos apoyamos:

| Qué | Por qué | Base legal |
| --- | --- | --- |
| Datos de inicio de sesión de Discord | Para crear tu cuenta, iniciar tu sesión y mostrar tu nombre y tu avatar | Contrato (prestarte el servicio que pediste) |
| Pertenencia a hermandades, personajes, solicitudes | Para gestionar las hermandades a las que te unes o envías solicitud | Contrato |
| Vínculo e instantánea de Battle.net | Para verificar tus personajes | Consentimiento (tú decides vincular, y puedes desvincular en cualquier momento) |
| Compartir informes de Vigil | Para mostrar tus resúmenes a los oficiales o a tu hermandad | Consentimiento (tú eliges la visibilidad de cada informe) |
| Resúmenes de Vigil que mantienes privados | Para darte tu propio análisis de rendimiento | Contrato |
| Solicitudes de soporte | Para responder a tu pregunta o resolver tu problema | Contrato |
| Registro de auditoría, límites de uso, registros de seguridad | Para que las hermandades rindan cuentas y el servicio sea seguro | Intereses legítimos |

No usamos tu información para publicidad, elaboración de perfiles ni decisiones automatizadas con efectos jurídicos o efectos igualmente significativos. Las puntuaciones de Vigil son para tu propio análisis.

## Quién puede ver qué

### Público (cualquiera en internet)

En el sitio de una hermandad, cualquiera puede ver:

- el nombre, la descripción, las páginas, el reglamento, el horario, las necesidades de reclutamiento, el progreso (muertes de jefes) y los listados de addons de la hermandad;
- la **plantilla**: el personaje principal y los alters de cada miembro activo, con nombre, apellido, facción, clase, especialización, rol, nivel, rango y si el personaje está verificado;
- las **páginas de personajes**: los mismos datos más el reino, las profesiones y los niveles de habilidad, la fecha de entrada del miembro, cuándo se sincronizó el personaje por última vez y los demás personajes del miembro.

Esto significa que cualquiera puede ver qué personajes pertenecen al mismo miembro. Los antiguos miembros y los personajes archivados no se muestran. Tu nombre de Discord, tu correo, tu BattleTag y tus solicitudes nunca se muestran públicamente.

Si una hermandad decide aparecer en el directorio de Guildbook, su nombre y su número de miembros activos aparecen en guildbook.io.

### Visible para los oficiales de una hermandad

- Las solicitudes a esa hermandad, incluidas tus respuestas de texto libre, tu usuario de Discord y tu BattleTag.
- La lista de miembros y los rangos de la hermandad.
- El registro de auditoría de la hermandad.
- Los informes de Vigil que hayas compartido con los oficiales o con la hermandad.

### Visible para los miembros de la hermandad

- Los informes de Vigil que hayas compartido con la hermandad.

### Visible solo para ti

- Tus informes privados de Vigil, tu vínculo con Battle.net y tu instantánea de personajes, y tus dispositivos emparejados.
- Tus solicitudes de soporte, que solo podéis ver tú y el operador de Guildbook.

### Proveedores de servicios

Usamos estos proveedores para gestionar Guildbook:

- **Vercel** (alojamiento y funciones serverless), Estados Unidos.
- **Neon** (alojamiento de la base de datos Postgres), en Estados Unidos (AWS us-east-2, Ohio).
- **Resend** (envío por correo de las solicitudes de soporte al operador), Estados Unidos.
- **Discord** (inicio de sesión) y **Blizzard Entertainment** (vinculación opcional de Battle.net y datos públicos de personajes). Actúan como servicios independientes sujetos a sus propias políticas de privacidad.

No compartimos tu información con nadie más, salvo cuando lo exija la ley, para proteger la seguridad de las personas o nuestros derechos, o como parte de un traspaso del servicio a un nuevo operador que acepte esta política.

## Dónde se guardan tus datos

Tus datos se guardan y se tratan en Estados Unidos. Si estás fuera de EE. UU., tu información se transfiere allí. Cuando la ley lo exige, nos apoyamos en las cláusulas contractuales tipo de nuestros proveedores o en garantías equivalentes para estas transferencias.

## Cuánto tiempo los conservamos

- **Cuenta y datos de Discord:** hasta que borres tu cuenta.
- **Vínculo con Battle.net:** hasta que lo desvincules o borres tu cuenta. **Al desvincularlo se borran tu ID de Battle.net, tu BattleTag, tu instantánea de personajes y tu token guardados.** Los personajes que habías verificado siguen en la plantilla de la hermandad pero se marcan como no verificados y dejan de sincronizarse con Blizzard. El registro de auditoría conserva constancia de que desvinculaste la cuenta, sin tu BattleTag.
- **Token de acceso de Battle.net:** caduca al cabo de unas 24 horas. Se elimina si Blizzard lo rechaza, y se borra cuando desvinculas.
- **Personajes:** los personajes archivados salen de la plantilla pero se conservan para que el historial de la hermandad siga intacto, hasta que se borre la hermandad o tu cuenta.
- **Solicitudes:** las solicitudes pendientes y aceptadas se conservan en los registros de la hermandad hasta que se borre la hermandad o tu cuenta. **Las solicitudes retiradas y rechazadas se borran automáticamente {{applicationRetentionDays}} días** después de resolverse (o, si nunca se revisaron, de enviarse), y el nombre del aspirante se sustituye por «Usuario eliminado» en las entradas de auditoría que le afectan.
- **Informes de Vigil:** hasta que los borres, o se borre tu pertenencia, la hermandad o tu cuenta.
- **Solicitudes de soporte:** hasta que se borre tu cuenta. Las copias enviadas por correo al operador se conservan en su buzón el tiempo necesario para atender la solicitud.
- **Dispositivos complementarios:** hasta que se borre la pertenencia, la hermandad o la cuenta. Los dispositivos revocados dejan de funcionar de inmediato.
- **Registro de auditoría:** se conserva mientras exista la hermandad. Cuando se borra una cuenta, sus entradas se mantienen, desidentificadas como se describe más abajo.
- **Contenido de la hermandad:** hasta que los líderes de la hermandad lo borren o se borre la hermandad. El propietario de una hermandad puede borrarla, con todos los datos de la hermandad de sus miembros y su registro de auditoría, desde los ajustes de la hermandad.
- **Registros del alojamiento:** según se describe en Información técnica.

## Tus derechos

Según dónde vivas, puedes tener derecho a:

- **acceder** a la información personal que tenemos sobre ti;
- **exportarla** en un formato portable;
- **rectificarla**;
- **suprimirla**;
- **oponerte** a algunos usos o **limitarlos**;
- **retirar tu consentimiento** en cualquier momento, por ejemplo desvinculando Battle.net o volviendo a hacer privado un informe de Vigil. Esto no afecta a nada de lo que hicimos antes de que lo retiraras.

La mayor parte puedes hacerlo tú mismo:

- **Exportar tus datos:** en guildbook.io/account, «Descargar mis datos» te da un archivo JSON con tu perfil, tus pertenencias, tus personajes, tus solicitudes, tus informes de Vigil, tus dispositivos, tus solicitudes de soporte y las entradas de auditoría que generaste.
- **Borrar tu cuenta:** en guildbook.io/account, escribe tu nombre para confirmar. Si eres el único administrador de una hermandad que tiene otros miembros, se te pedirá que primero asciendas a otro miembro a un rango de administrador (o que borres la hermandad). Una hermandad en la que eres el único miembro se borra junto con tu cuenta.
- Editar o archivar tus personajes, retirar solicitudes pendientes, cambiar la visibilidad de tus informes de Vigil o borrarlos, revocar dispositivos complementarios y desvincular Battle.net.

Para cualquier otra cosa, escribe a [matt.rosendin@gmail.com](mailto:matt.rosendin@gmail.com) desde la dirección de tu cuenta de Discord, o dinos tu nombre de usuario de Discord para que podamos confirmar que eres tú. Responderemos en un plazo de 7 días.

Cuando borras tu cuenta, borramos tu perfil, tu inicio de sesión de Discord, tus pertenencias, tus personajes, tus solicitudes, tus informes y preferencias de Vigil, tus dispositivos complementarios, tus solicitudes de soporte y tu vínculo y token de Battle.net. El contenido de la hermandad que editaste como oficial se queda con la hermandad, sin tu nombre. **Las entradas del registro de auditoría se desidentifican:** cada entrada se conserva con su acción y su fecha, pero apareces como «Usuario eliminado», y tu nombre, los nombres de tus personajes, tu BattleTag y tu usuario de Discord que figuren en ella se sustituyen por «Usuario eliminado». Las copias en las copias de seguridad de nuestro proveedor de base de datos caducan según su calendario normal de copias de seguridad.

También puedes presentar una reclamación ante tu autoridad local de protección de datos.

## Menores

Guildbook no está pensado para menores de 13 años, y además debes cumplir la edad mínima de Discord donde vivas. No recogemos a sabiendas información de nadie menor de 13 años. Si crees que un menor de 13 años está usando Guildbook, contacta con nosotros y borraremos la cuenta.

## Seguridad

Protegemos tu información con:

- HTTPS para todo el tráfico;
- cookies de sesión firmadas y solo HTTP;
- cifrado AES-256-GCM para los tokens de acceso de Battle.net;
- guardando solo hashes de los códigos de emparejamiento y de los tokens de dispositivo de la app complementaria;
- controles de acceso que mantienen separados los datos de cada hermandad y limitan las solicitudes, el registro de auditoría y los informes compartidos a los rangos adecuados;
- tokens de un solo uso de 60 segundos al iniciar tu sesión en el dominio propio de una hermandad;
- límites de uso en el emparejamiento de la app complementaria, en las subidas de Vigil desde la app complementaria y en la creación de hermandades.

Ningún sistema es perfectamente seguro. Si una brecha afecta a tu información personal, te lo notificaremos a ti y a las autoridades según exija la ley.

## Cookies

Usamos **solo cookies esenciales**, necesarias para iniciar sesión y para la seguridad:

- **Cookie de sesión** (`authjs.session-token`): un token firmado y cifrado (JWT) que mantiene tu sesión iniciada, durante un máximo de 30 días. Se comparte entre guildbook.io y los subdominios de las hermandades para que solo tengas que iniciar sesión una vez. Una hermandad en un dominio propio tiene su propia cookie de sesión para ese dominio.
- **Cookies de seguridad del inicio de sesión** que pone nuestra biblioteca de inicio de sesión (como `authjs.csrf-token`, `authjs.callback-url` y cookies de estado de OAuth de corta duración) para proteger el proceso de inicio de sesión con Discord.
- **Cookie de vinculación de Battle.net** (`bnet_oauth`): protege el proceso de vinculación de Battle.net y caduca a los 10 minutos.

No usamos cookies de analítica, de publicidad ni de seguimiento, ni rastreadores de terceros. Como estas cookies son esenciales, no pedimos consentimiento para ellas. Si las bloqueas, no podrás iniciar sesión.

## Cambios en esta política

Podemos actualizar esta política. Cuando lo hagamos, cambiaremos la fecha de "Última actualización" de arriba y, en los cambios importantes, intentaremos avisar en el sitio antes de que entren en vigor.

## Contacto

Preguntas o peticiones sobre tu privacidad: [matt.rosendin@gmail.com](mailto:matt.rosendin@gmail.com).
