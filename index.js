const fs = require("fs");
const path = require("path");
const { MessageMedia } = require("whatsapp-web.js");

const { enviarHorarios } = require("./src/services/enviarHorarios");
const { crearCliente } = require("./src/bot/cliente");
const { normalizarTexto } = require("./src/utils/normalizar");
const { encontrarPrograma } = require("./src/services/encontrarPrograma");

// --- ❗️ REDES DE SEGURIDAD GLOBALES ❗️ ---
process.on('unhandledRejection', (reason, promise) => {
    console.error('=============== ❗️ RECHAZO DE PROMESA NO MANEJADO ❗️ ===============');
    console.error('Razón:', reason);
    console.error('===================================================================');
});

process.on('uncaughtException', (error) => {
    console.error('=============== ❗️ EXCEPCIÓN NO CAPTURADA ❗️ ===============');
    console.error('Error:', error);
    console.error('============================================================');
    process.exit(1);
});
// ---------------------------------------------

// --- INICIALIZACIÓN DE SERVIDOR Y CLIENTE ---
const { iniciarServidor } = require("./src/dashboard/server");
iniciarServidor(); // Inicia el servidor

const client = crearCliente();
let estadoUsuarios = {}; // 🔹 Estado para seguir conversaciones (es 'let')

// --- CONFIGURACIÓN DE RUTAS ---
const projectRoot = process.cwd();
const mediaPath = path.join(projectRoot, 'media');

const PATHS = {
    ESTADOS: path.join(projectRoot, "src", "database", "estados.json"),
    PROGRAMAS: path.join(projectRoot, "src", "database", "programas.json"),
    PLUS: path.join(projectRoot, "src", "database", "plus.json"),
    SALUDOS: path.join(projectRoot, "src", "database", "saludos.json"),
    PERFIL: path.join(projectRoot, "src", "database", "perfil.json"),
    CTA: path.join(projectRoot, "src", "database", "cta.json"),
};

// --- ESTRUCTURA DE DATOS EN MEMORIA ---
let programasData = [];
let plusData = {};
let saludosData = {};
let perfilData = {};
let ctaData = {};

// --- MANEJO DE ESTADO PERSISTENTE ---
function loadEstados() {
    try {
        if (fs.existsSync(PATHS.ESTADOS)) {
            const data = fs.readFileSync(PATHS.ESTADOS, "utf8");
            estadoUsuarios = JSON.parse(data);
            console.log("✅ Estados de usuario cargados correctamente.");
        } else {
            console.log("ℹ️ No se encontró 'estados.json'. Iniciando vacío.");
            estadoUsuarios = {};
        }
    } catch (error) {
        console.error("❌ Error cargando estados.json. Iniciando vacío:", error.message);
        estadoUsuarios = {};
    }
}

async function saveEstados() {
    try {
        await fs.promises.writeFile(PATHS.ESTADOS, JSON.stringify(estadoUsuarios, null, 2), "utf8");
    } catch (err) {
        console.error("❌ Error guardando estados.json:", err.message);
    }
}

// --- CARGA DE DATOS ---
function loadAllData() {
    try {
        programasData = JSON.parse(fs.readFileSync(PATHS.PROGRAMAS, "utf8"));
        plusData = JSON.parse(fs.readFileSync(PATHS.PLUS, "utf8"));
        saludosData = JSON.parse(fs.readFileSync(PATHS.SALUDOS, "utf8"));
        perfilData = JSON.parse(fs.readFileSync(PATHS.PERFIL, "utf8"));
        ctaData = JSON.parse(fs.readFileSync(PATHS.CTA, "utf8"));
        console.log("✅ Todos los datos JSON cargados correctamente en memoria.");
    } catch (error) {
        console.error("❌ Error al cargar datos JSON:", error.message);
        perfilData = {
            texto: "🚨 *Para asesorarte y brindarte la INVERSIÓN del programa, por favor indícame tu perfil:* \n1) Soy egresado...\n5) Soy independiente"
        };
    }
}

// --- FUNCIÓN DE UTILIDAD: DENTRO DE HORARIO ---
function estaDentroHorario() {
    const ahora = new Date();
    const opciones = { timeZone: "America/Lima", hour: "2-digit", hour12: false, weekday: "long" };
    const horaPeru = parseInt(ahora.toLocaleString("es-PE", opciones), 10);
    const dia = ahora.toLocaleDateString("es-PE", { timeZone: "America/Lima", weekday: "long" }).toLowerCase();
    const esFinDeSemana = (dia === "sábado" || dia === "domingo");
    if (!esFinDeSemana && horaPeru >= 9 && horaPeru < 18) { return true; }
    if (esFinDeSemana && horaPeru >= 9 && horaPeru < 13) { return true; }
    return false;
}

// --- 💰 NUEVA FUNCIÓN DE UTILIDAD: CONVERTIR MONEDA ---
function formatearPrecio(numero, precioSoles) {
    const TIPO_CAMBIO_USD = 3.7;

    // El 'numero' viene como '519...@c.us' o '549...@c.us'
    const esPeru = numero.startsWith("51");

    // Limpiar el precioSoles por si viene como string con comas
    const valorSoles = parseFloat(String(precioSoles).replace(/,/g, ''));

    if (isNaN(valorSoles)) {
        return "Precio no disponible"; // Fallback por si el dato está mal
    }

    if (esPeru) {
        // 1. Si es de Perú, lo deja en Soles
        return `S/ ${valorSoles}`;
    } else {
        // 2. Si es extranjero, convierte a USD y REDONDEA
        const precioUSD = Math.round(valorSoles / TIPO_CAMBIO_USD);
        return `USD ${precioUSD}`;
    }
}
// ---------------------------------------------------

// --- ✨ NUEVA FUNCIÓN REFACTORIZADA ---
// Agrupa el envío de los 6 mensajes iniciales
// ❗️ CORRECCIÓN: 'numero' aquí es el 'idParaResponder'. Se usa para todo.
async function enviarBloqueInfo(numero, p) {
    if (saludosData?.texto) await client.sendMessage(numero, saludosData.texto);
    if (p.PERSONALIZADO) await client.sendMessage(numero, p.PERSONALIZADO);

    const videoPath = p.VIDEO ? path.join(mediaPath, p.VIDEO) : null;
    const imagePath = p.POSTDOCEN ? path.join(mediaPath, p.POSTDOCEN) : null;
    const pdfPath = p.BROCHURE ? path.join(mediaPath, p.BROCHURE) : null;

    if (videoPath && fs.existsSync(videoPath)) {
        await client.sendMessage(numero, MessageMedia.fromFilePath(videoPath));
    } else if (imagePath && fs.existsSync(imagePath)) {
        await client.sendMessage(numero, MessageMedia.fromFilePath(imagePath));
    }

    if (p.BENEFICIOS) await client.sendMessage(numero, p.BENEFICIOS);

    if (pdfPath && fs.existsSync(pdfPath)) {
        await client.sendMessage(numero, MessageMedia.fromFilePath(pdfPath));
    }

    // 'enviarHorarios' también envía mensajes, así que usa el 'idParaResponder' (que es 'numero' aquí)
    await enviarHorarios(client, numero, p.PROGRAMA);

    const perfilMsg = perfilData?.texto || "🚨 *Para asesorarte y brindarte la INVERSIÓN del programa, por favor indícame tu perfil...*";
    await client.sendMessage(numero, perfilMsg);
}
// ----------------------------------------

// 🚨 Cargar datos al inicio del bot
loadAllData();
loadEstados();
// -----------------------------------------------------

client.on("message", async (message) => {
    try {
        // --- ❗️ CORRECCIÓN: FILTRO MEJORADO ---
        // Acepta solo chats 1-a-1 (terminados en @c.us o @lid) y que sean de tipo 'chat'
        if ((!message.from.endsWith("@c.us") && !message.from.endsWith("@lid")) || message.type !== "chat") {
            return;
        }

        const textoOriginal = (message.body || "").trim();
        const texto = normalizarTexto(textoOriginal);

        // --- ⬇️ INICIO DE LA SOLUCIÓN LID/JID ⬇️ ---
        // 1. ID PARA RESPONDER (El que te escribió, puede ser @lid)
        const idParaResponder = message.from;

        // 2. ID PARA LÓGICA (El número real, siempre @c.us)
        const contact = await message.getContact();
        const numero = contact.id._serialized; // Sigue siendo 'numero' para tu lógica
        // --- ⬆️ FIN DE LA SOLUCIÓN ⬆️ ---

        const nombre = message._data?.notifyName || "Sin nombre";

        const opciones = { timeZone: 'America/Lima', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' };
        const fechaYHoraPeru = new Date().toLocaleString('es-PE', opciones);
        console.log(`\n[${fechaYHoraPeru}] 📩 Mensaje de ${nombre} (${numero}): ${textoOriginal}`);

        // -----------------------------------------------------------------
        // --- ❗️ FLUJO 0: INICIO O REINICIO DE CONVERSACIÓN (MÁXIMA PRIORIDAD) ---
        // -----------------------------------------------------------------
        if (texto.includes("hola, estoy en") || texto.includes("info") || texto.includes("información") || texto.includes("facilitar") || texto.includes("quiero") || texto.includes("quisiera")) {
            const resultados = encontrarPrograma(textoOriginal, programasData);

            if (resultados.length === 1) {
                const p = resultados[0];

                // 1. Guardar estado temporal ANTES de enviar (usa 'numero' real)
                estadoUsuarios[numero] = {
                    estado: "enviandoInfo", // Estado temporal
                    nombrePrograma: p.PROGRAMA,
                    edicion: p.EDICION,
                    categoria: (p.CATEGORIA || "").toUpperCase()
                };
                await saveEstados();
                console.log(`[FLOW 0] Estado 'enviandoInfo' guardado para ${numero}.`);

                // 2. Intentar enviar el bloque completo (usa 'idParaResponder')
                try {
                    await enviarBloqueInfo(idParaResponder, p);
                } catch (sendError) {
                    console.error(`❌ Falla al enviar bloque de info a ${idParaResponder}. El estado persiste como 'enviandoInfo'.`, sendError);
                    return; // Salir. El estado ya está guardado como "enviandoInfo".
                }

                // 3. Si TODO salió bien, guardar estado FINAL (usa 'numero' real)
                estadoUsuarios[numero].estado = "esperandoPerfil";
                await saveEstados();
                console.log(`[FLOW 0] Bloque enviado OK. Estado 'esperandoPerfil' guardado para ${numero}.`);
                return;
            }

            // -----------------------------------------------------------------
            // --- ❗️ FLUJO 0.5: REINTENTO POR FALLO DE ENVÍO ---
            // -----------------------------------------------------------------
        } else if (estadoUsuarios[numero]?.estado === "enviandoInfo") {
            console.warn(`[FLOW 0.5] Detectado estado 'enviandoInfo' para ${numero} con texto: '${texto}'. Reintentando envío...`);

            const { nombrePrograma, edicion } = estadoUsuarios[numero];
            const p = programasData.find(
                (pr) => normalizarTexto(pr.PROGRAMA) === normalizarTexto(nombrePrograma) &&
                    normalizarTexto(pr.EDICION) === normalizarTexto(edicion)
            );

            if (!p) {
                console.error(`[FLOW 0.5] No se pudo encontrar el programa ${nombrePrograma} para el reintento.`);
                delete estadoUsuarios[numero];
                await saveEstados();
                return;
            }

            // 1. Reintentar enviar el bloque completo (usa 'idParaResponder')
            try {
                await enviarBloqueInfo(idParaResponder, p);
            } catch (sendError) {
                console.error(`❌ Falla en el REINTENTO de envío a ${idParaResponder}. El estado persiste como 'enviandoInfo'.`, sendError);
                return; // Salir. Esperar otro mensaje del usuario para reintentar.
            }

            // 2. Si el REINTENTO salió bien, guardar estado FINAL (usa 'numero' real)
            estadoUsuarios[numero].estado = "esperandoPerfil";
            await saveEstados();
            console.log(`[FLOW 0.5] Reintento enviado OK. Estado 'esperandoPerfil' guardado para ${numero}.`);
            // NO HACER RETURN, dejar que procese el mensaje actual
        }

        // -----------------------------------------------------------------
        // --- FLUJO 1: ESPERANDO PERFIL (Respuesta 1-5) ---
        // -----------------------------------------------------------------
        else if (estadoUsuarios[numero]?.estado === "esperandoPerfil") {
            const { nombrePrograma, edicion } = estadoUsuarios[numero];
            const p = programasData.find(
                (pr) => normalizarTexto(pr.PROGRAMA) === normalizarTexto(nombrePrograma) &&
                    normalizarTexto(pr.EDICION) === normalizarTexto(edicion)
            );

            if (!p) {
                delete estadoUsuarios[numero];
                await saveEstados();
                return;
            }

            let resKeyName = "";
            switch (texto) {
                case "1": resKeyName = "RES1"; break;
                case "2": resKeyName = "RES2"; break;
                case "3": resKeyName = "RES3"; break;
                case "4": resKeyName = "RES4"; break;
                case "5": resKeyName = "RES5"; break;
                default:
                    console.log(`[FLOW 1] Respuesta inválida para 'esperandoPerfil': ${texto}`);
                    return; // No hacer nada, esperar respuesta 1-5
            }

            const resValue = p[resKeyName];
            if (resValue) {
                await client.sendMessage(idParaResponder, resValue); // Usa idParaResponder
            }

            const esEstudiante = texto === "3" || texto === "4";
            const esCurso = (p.CATEGORIA || "").toUpperCase() === "CURSO";
            let inversionMsg = "";

            // Lógica de Inversión (usa 'numero' para formatearPrecio)
            if (esCurso) {
                if (esEstudiante) {
                    inversionMsg = `*Hasta el Viernes 14 de Noviembre por CyberWow 💥😲*

Opciones de pago:
1️⃣ *Al Contado* Ahorro máximo😉
🔥55% Dcto > ${formatearPrecio(numero, p["EXEST"])} ~(Normal ${formatearPrecio(numero, p["INV EST T"])})~

2️⃣ *En Cuotas sin intereses*
50% Dcto > ${formatearPrecio(numero, p["INV EST"])} ~(Normal ${formatearPrecio(numero, p["INV EST T"])})~
💳 Reserva con ${formatearPrecio(numero, p["RESEST"])}

*La inversión incluye el CERTIFICADO* 📚`;
                } else {
                    inversionMsg = `*Hasta el Viernes 14 de Noviembre por CyberWow 💥😲*

Opciones de pago:
1️⃣ *Al Contado* Ahorro máximo😉
🔥55% Dcto > ${formatearPrecio(numero, p["EXPRO"])} ~(Normal ${formatearPrecio(numero, p["INV PRO T"])})~

2️⃣ *En Cuotas sin intereses*
50% Dcto > ${formatearPrecio(numero, p["INV PRO"])} ~(Normal ${formatearPrecio(numero, p["INV PRO T"])})~
💳 Reserva con ${formatearPrecio(numero, p["RESPRO"])}

*La inversión incluye el CERTIFICADO* 📚`;
                }
            } else {
                if (esEstudiante) {
                    inversionMsg = `*Hasta el Viernes 14 de Noviembre por CyberWow 💥😲*

Facilidades de pago:
1️⃣ *En Cuotas sin Intereses* 🔥50% Dcto > ${formatearPrecio(numero, p["INV EST"])} ~(Normal ${formatearPrecio(numero, p["INV EST T"])})~
💳 Reserva con ${formatearPrecio(numero, p["RESEST"])}

2️⃣ *Al Contado* Ahorro máximo😉
🔥55% Dcto > ${formatearPrecio(numero, p["EXEST"])} ~(Normal ${formatearPrecio(numero, p["INV EST T"])})~

*La inversión incluye el CERTIFICADO* 📚`;
                } else {
                    inversionMsg = `*Hasta el Viernes 14 de Noviembre por CyberWow 💥😲*

Facilidades de pago:
1️⃣ *En Cuotas sin Intereses* 🔥50% Dcto > ${formatearPrecio(numero, p["INV PRO"])} ~(Normal ${formatearPrecio(numero, p["INV PRO T"])})~
💳 Reserva con ${formatearPrecio(numero, p["RESPRO"])}

2️⃣ *Al Contado* Ahorro máximo😉
🔥55% Dcto > ${formatearPrecio(numero, p["EXPRO"])} ~(Normal ${formatearPrecio(numero, p["INV PRO T"])})~

*La inversión incluye el CERTIFICADO* 📚`;
                }
            }

            await client.sendMessage(idParaResponder, inversionMsg); // Usa idParaResponder
            if (plusData?.texto) await client.sendMessage(idParaResponder, plusData.texto); // Usa idParaResponder
            if (ctaData?.texto) await client.sendMessage(idParaResponder, ctaData.texto); // Usa idParaResponder

            // Actualizar estado (usa 'numero' real)
            estadoUsuarios[numero] = {
                estado: "esperandoDecision",
                nombrePrograma: p.PROGRAMA,
                edicion: p.EDICION,
                esEstudiante,
                categoria: (p.CATEGORIA || "").toUpperCase()
            };
            await saveEstados();
            return;
        }

        // -----------------------------------------------------------------
        // --- FLUJO 2: ESPERANDO DECISIÓN (Después de la Inversión) ---
        // -----------------------------------------------------------------
        else if (estadoUsuarios[numero]?.estado === "esperandoDecision") {
            const msgFuera = "✨ Genial, en un momento un asesor se comunicará contigo para resolver tus consultas 😄";
            const msgDentro = "⏰ ¡Estamos contentos de poder ayudarte en tu elección! Un asesor se comunicará contigo el día de *mañana*. Por favor, indícame un *horario* para que se contacte contigo. 🙋🏻‍♀️";

            switch (texto) {
                case "1":
                case "2": // Opción de inscripción
                    await client.sendMessage(idParaResponder, `*¡Perfecto!* La inscripción es muy sencilla 😇\n\nContamos con los siguientes MÉTODOS DE PAGO👇🏻\n\n1️⃣ Yape 📲\n2️⃣ Depósito o transferencia bancaria 🏛️\n3️⃣ Pago online vía Web 🌐(Aceptamos todas las tarjetas 💳)\n\nComéntame *¿Cuál sería tu mejor opción de pago?* 😊`);
                    estadoUsuarios[numero].estado = "esperandoMetodoPago";
                    await saveEstados();
                    return;
                case "3":
                case "4": // Opción de llamada/asesoría
                    await client.sendMessage(idParaResponder, estaDentroHorario() ? msgDentro : msgFuera);
                    delete estadoUsuarios[numero];
                    await saveEstados();
                    return;
                default:
                    console.log(`[FLOW 2] Respuesta inválida para 'esperandoDecision': ${texto}`);
                    return; // No hacer nada, esperar respuesta 1-4
            }
        }

        // -----------------------------------------------------------------
        // --- FLUJO 3: ESPERANDO MÉTODO DE PAGO ---
        // -----------------------------------------------------------------
        else if (estadoUsuarios[numero]?.estado === "esperandoMetodoPago") {
            const { nombrePrograma, edicion } = estadoUsuarios[numero];
            const p = programasData.find(
                (pr) => normalizarTexto(pr.PROGRAMA) === normalizarTexto(nombrePrograma) &&
                    normalizarTexto(pr.EDICION) === normalizarTexto(edicion)
            );

            if (!p) {
                delete estadoUsuarios[numero];
                await saveEstados();
                return;
            }

            const esEstudiante = estadoUsuarios[numero].esEstudiante;
            const esCurso = (estadoUsuarios[numero].categoria || "CURSO") === "CURSO";
            const datosMsg = esEstudiante ?
                `*Bríndame por favor, los siguientes datos*:\n\n🔹DNI o CÉDULA:\n🔹Nombre completo:\n🔹Número de Celular:\n🔹Fecha de Inicio:\n🔹Correo (Gmail):\n🔹Foto de Voucher:\n🔹Foto de Intranet o Carnet Universitario:\n\nY listo! 🌟 Cuando realices el pago y envío de tus datos, me avisas para comentarte los siguientes detalles. 🙋🏻‍♀️💙` :
                `*Bríndame por favor, los siguientes datos*:\n\n🔹DNI o CÉDULA:\n🔹Nombre completo:\n🔹Número de Celular:\n🔹Fecha de Inicio:\n🔹Correo (Gmail):\n🔹Foto de Voucher:\n\nY listo! 🌟 Cuando realices el pago y envío de tus datos, me avisas para comentarte los siguientes detalles. 🙋🏻‍♀️💙`;

            // --- Pago 1: Yape ---
            if (texto.includes("1") || texto.includes("yape")) {
                // ❗️ CORRECCIÓN: Usar idParaResponder
                await client.sendMessage(idParaResponder, `*Perfecto* ✨\n\nTe envío el número de Yape y Código QR 👇\n\n📲 979 493 060 // WE Foundation`);
                const nombreYape = esCurso ? "yapecursos.jpeg" : "yapeprog.jpeg";
                const rutaQR = path.join(mediaPath, "pago", nombreYape);
                if (fs.existsSync(rutaQR)) {
                    // ❗️ CORRECCIÓN: Usar idParaResponder
                    await client.sendMessage(idParaResponder, MessageMedia.fromFilePath(rutaQR));
                }
                await client.sendMessage(idParaResponder, datosMsg);
                delete estadoUsuarios[numero];
                await saveEstados();
                return;
            }

            if (texto.includes("2") || texto.includes("bcp") || texto.includes("deposito") || texto.includes("transferencia")) {
                const mensajeDepo = esCurso ?
                    `👉 ¡Excelente! Te comparto los datos de nuestra cuenta para que realices la transferencia:

🏛️ *Banco: BCP*
Número de cuenta: 193-9914694-0-22

y desde *otros Bancos*, puedes transferir a esta cuenta:
CCI: 00219300991469402218

*Titular*: WE Foundation` :
                    `👉 ¡Excelente! Te comparto los datos de nuestra cuenta para que realices la transferencia:

🏛️ *Banco: BCP*
Número de cuenta: 193-9285511-0-38

y desde *otros Bancos*, puedes transferir a esta cuenta:
CCI: 002-19300928551103810

*Titular*: WE Educación Ejecutiva SAC`;
                await client.sendMessage(idParaResponder, mensajeDepo);
                await client.sendMessage(idParaResponder, datosMsg);
                delete estadoUsuarios[numero];
                await saveEstados();
                return;
            }

            // --- Pago 3: Web ---
            if (texto.includes("3") || texto.includes("web")) {
                if (!p.ENLACE) {
                    delete estadoUsuarios[numero];
                    await saveEstados();
                    return;
                }
                const mensajeTexto = `👉 “Perfecto, puedes hacer tu pago de manera rápida y 100% segura...\n\n🔗 ${p["ENLACE"]}\n\n...`;
                await client.sendMessage(idParaResponder, mensajeTexto);
                const rutaVideo = path.join(mediaPath, "videos", "WEB.mp4");
                if (fs.existsSync(rutaVideo)) {
                    await client.sendMessage(idParaResponder, MessageMedia.fromFilePath(rutaVideo));
                }
                estadoUsuarios[numero].estado = "esperandoDecisionWeb";
                await saveEstados();
                const followUpMessage = `💳 Cuentame, ¿Pudiste completar tu pago en el link web? 🌐\n\n1️⃣ Sí, todo correcto 🙌\n2️⃣ Aún no, necesito ayuda 🤔`;
                setTimeout(async () => {
                    try {
                        // Re-chequear estado antes de enviar
                        if (estadoUsuarios[numero]?.estado === "esperandoDecisionWeb") {
                            await client.sendMessage(idParaResponder, followUpMessage);
                            console.log(`✅ Mensaje de seguimiento enviado a ${idParaResponder}.`);
                        }
                    } catch (error) {
                        console.error(`❌ Error en el setTimeout para follow-up de ${idParaResponder}:`, error);
                    }
                }, 3 * 60 * 1000); // 3 minutos
                return;
            }

            console.log(`[FLOW 3] Respuesta inválida para 'esperandoMetodoPago': ${texto}`);
            return; // No hacer nada, esperar respuesta 1-3
        }

        // -----------------------------------------------------------------
        // --- FLUJO 4: ESPERANDO DECISIÓN WEB ---
        // -----------------------------------------------------------------
        else if (estadoUsuarios[numero]?.estado === "esperandoDecisionWeb") {
            if (texto === "1") {
                await client.sendMessage(idParaResponder, `*¡Ya te hemos registrado al Programa!* 🚀\nRecuerda tener en cuenta lo siguiente 💙👇🏻`);
                const IMAGEN_REGISTRO_PATH = path.join(mediaPath, "pago", "webins.jpg");
                if (fs.existsSync(IMAGEN_REGISTRO_PATH)) {
                    await client.sendMessage(idParaResponder, MessageMedia.fromFilePath(IMAGEN_REGISTRO_PATH));
                } else {
                    console.log("⚠️ No se encontró la imagen de registro completo.");
                }
                await client.sendMessage(idParaResponder, `*Bienvenid@ a la Comunidad WE* 💙\n¡Que disfrutes tu programa!\n\n📲 *Agéndanos en tus contactos* ...\n\n👩🏻‍💻 *Evalúa nuestra atención* 👉🏼 bit.ly/4azD6Z4\n\n👥 *Únete a nuestra Comunidad WE* 👉🏼 bit.ly/COMUNIDAD_WE \n\n¡Gracias por confiar en WE! 🚀`);
                await client.sendMessage(idParaResponder, `💎 *Beneficio Exclusivo* 💎\n\nPor tu inscripción, adquiere la MEMBRESÍA PLUS...\n\n _Válido por 3 días_ 📍`);
                delete estadoUsuarios[numero];
                await saveEstados();
                return;

            } else if (texto === "2") {
                const msgFuera = "✨ Genial, en un momento un asesor se comunicará contigo para resolver tus consultas 😄";
                const msgDentro = "⏰ ¡Estamos contentos de poder ayudarte en tu elección! Un asesor se comunicará contigo el día de *mañana*. Por favor, indícame un *horario* para que se contacte contigo. 🙋🏻‍♀️";
                await client.sendMessage(idParaResponder, estaDentroHorario() ? msgDentro : msgFuera);
                delete estadoUsuarios[numero];
                await saveEstados();
                return;
            } else {
                console.log(`[FLOW 4] Respuesta inválida para 'esperandoDecisionWeb': ${texto}`);
                return; // No hacer nada, esperar respuesta 1-2
            }
        }

    } catch (error) {
        console.error("❌ Error procesando mensaje:", error);
        if (error.message.includes('Protocol error (Runtime.callFunctionOn)')) {
            console.log("🚨 Reintentando inicializar el cliente de WhatsApp en 10 segundos...");
            setTimeout(() => {
                client.initialize();
            }, 10000);
        }
    }
});

client.initialize();