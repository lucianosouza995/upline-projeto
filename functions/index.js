/* eslint-disable max-len */
/* eslint-disable indent */

// --- IMPORTAÇÕES V2 ---
const { onRequest, onCall, HttpsError } = require("firebase-functions/v2/https");
// MUDANÇA AQUI: Importamos 'onDocumentWritten' em vez de 'onDocumentCreated'
const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const admin = require("firebase-admin");
const cors = require("cors")({origin: true});

admin.initializeApp();
const db = admin.firestore();

// --- FUNÇÕES AUXILIARES ---
function calcularDistancia(lat1, lon1, lat2, lon2) {
    const R = 6371.0; 
    const lat1Rad = lat1 * Math.PI / 180;
    const lon1Rad = lon1 * Math.PI / 180;
    const lat2Rad = lat2 * Math.PI / 180;
    const lon2Rad = lon2 * Math.PI / 180;
    const dlon = lon2Rad - lon1Rad;
    const dlat = lat2Rad - lat1Rad;
    const a = Math.sin(dlat / 2) ** 2 + Math.cos(lat1Rad) * Math.cos(lat2Rad) * Math.sin(dlon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 1. HTTP: Abrir Chamado (Via Chatbot - Automático)
 */
exports.abrirChamado = onRequest((request, response) => {
    cors(request, response, async () => {
        const dados = request.body;
        if (!dados.codigo_qr || dados.pessoa_presa === undefined || !dados.descricao) {
            return response.status(400).json({erro: "Dados incompletos."});
        }

        try {
            const elevadorSnapshot = await db.collection("elevadores").where("codigo_qr", "==", dados.codigo_qr).limit(1).get();
            if (elevadorSnapshot.empty) return response.status(404).json({erro: "Elevador não encontrado."});

            const elevadorDoc = elevadorSnapshot.docs[0];
            const elevador = elevadorDoc.data();
            const tecnicosSnapshot = await db.collection("tecnicos").where("de_plantao", "==", true).get();

            if (tecnicosSnapshot.empty) {
                const ref = await db.collection("chamados").add({
                    descricao_problema: dados.descricao,
                    pessoa_presa: Boolean(dados.pessoa_presa),
                    elevador_id: elevadorDoc.id,
                    endereco_elevador: elevador.endereco,
                    status: "aberto",
                    timestamp: admin.firestore.FieldValue.serverTimestamp(),
                });
                return response.status(201).json({ mensagem: "Chamado aberto (sem técnicos).", id_chamado: ref.id });
            }

            let tecnicoMaisProximo = null;
            let menorDistancia = Infinity;
            const elevadorPos = elevador.localizacao;

            tecnicosSnapshot.forEach((doc) => {
                const t = doc.data();
                if (t.localizacao_atual) {
                    const dist = calcularDistancia(elevadorPos.latitude, elevadorPos.longitude, t.localizacao_atual.latitude, t.localizacao_atual.longitude);
                    if (dist < menorDistancia) {
                        menorDistancia = dist;
                        tecnicoMaisProximo = {id: doc.id, ...t};
                    }
                }
            });

            if (!tecnicoMaisProximo) return response.status(500).json({erro: "Erro ao localizar técnicos."});

            const ref = await db.collection("chamados").add({
                descricao_problema: dados.descricao,
                pessoa_presa: Boolean(dados.pessoa_presa),
                elevador_id: elevadorDoc.id,
                endereco_elevador: elevador.endereco,
                status: "atribuido",
                tecnico_id: tecnicoMaisProximo.id,
                tecnico_nome: tecnicoMaisProximo.nome,
                timestamp: admin.firestore.FieldValue.serverTimestamp(),
            });

            return response.status(201).json({ mensagem: "Chamado atribuído!", id_chamado: ref.id, tecnico_atribuido: tecnicoMaisProximo.nome });

        } catch (error) {
            console.error(error);
            return response.status(500).json({erro: "Erro interno."});
        }
    });
});

/**
 * 2. CALLABLE: Criar Chamado Manual (Para Admin)
 */
exports.criarChamadoManual = onCall(async (request) => {
    if (!request.auth || request.auth.token.role !== 'admin') {
        throw new HttpsError('permission-denied', 'Apenas admins podem criar chamados.');
    }

    const data = request.data;
    if (!data.descricao) {
        throw new HttpsError('invalid-argument', 'A descrição do problema é obrigatória.');
    }

    let novoChamado = {
        pessoa_presa: Boolean(data.pessoa_presa),
        status: "aberto",
        timestamp: admin.firestore.FieldValue.serverTimestamp()
    };

    if (data.elevador_id && data.elevador_id !== "MANUAL") {
        const elevDoc = await db.collection('elevadores').doc(data.elevador_id).get();
        if (!elevDoc.exists) throw new HttpsError('not-found', 'Elevador não encontrado.');
        const elevData = elevDoc.data();
        novoChamado.elevador_id = data.elevador_id;
        novoChamado.endereco_elevador = elevData.endereco;
        novoChamado.descricao_problema = `${elevData.cliente_nome}: ${data.descricao}`;
    } else {
        if (!data.endereco || !data.cliente) throw new HttpsError('invalid-argument', 'Endereço e Nome obrigatórios.');
        novoChamado.elevador_id = "MANUAL";
        novoChamado.endereco_elevador = data.endereco;
        novoChamado.descricao_problema = `${data.cliente}: ${data.descricao}`;
    }

    if (data.tecnico_id) {
        const tecDoc = await db.collection('tecnicos').doc(data.tecnico_id).get();
        if (tecDoc.exists) {
            novoChamado.status = "atribuido";
            novoChamado.tecnico_id = data.tecnico_id;
            novoChamado.tecnico_nome = tecDoc.data().nome;
        }
    }

    const ref = await db.collection("chamados").add(novoChamado);
    return { success: true, id: ref.id };
});

/**
 * 3. CALLABLE: Criar Técnico
 */
exports.criarTecnico = onCall(async (request) => {
    if (!request.auth || request.auth.token.role !== 'admin') {
        throw new HttpsError('permission-denied', 'Apenas admins.');
    }
    const { nome, email, password } = request.data;
    if (!nome || !email || !password || password.length < 6) {
        throw new HttpsError('invalid-argument', 'Dados inválidos.');
    }

    let uid;
    try {
        const userRecord = await admin.auth().createUser({ email, password, displayName: nome });
        uid = userRecord.uid;
        await admin.auth().setCustomUserClaims(uid, { role: 'tecnico' });
        await db.collection('tecnicos').doc(uid).set({
            nome, email, de_plantao: false, fcm_token: null, last_latitude: null, last_longitude: null
        });
        return { success: true, uid };
    } catch (error) {
        if (uid) admin.auth().deleteUser(uid).catch(() => {});
        throw new HttpsError('internal', error.message);
    }
});

/**
 * 4. GATILHO ATUALIZADO: Enviar Notificação em Criação OU Atualização
 * Agora usa 'onDocumentWritten' para pegar as atribuições manuais.
 */
exports.enviarNotificacaoChamado = onDocumentWritten("chamados/{chamadoId}", async (event) => {
    // 1. Se o documento foi apagado, não faz nada
    if (!event.data.after.exists) return;

    const novo = event.data.after.data();
    const antigo = event.data.before.data(); // Pode ser undefined (se for criação)

    // 2. Validação: Só envia se estiver ATRIBUÍDO e tiver um técnico definido
    if (novo.status !== 'atribuido' || !novo.tecnico_id) return;

    // 3. Lógica Inteligente de Disparo:
    // - Cenário A (Criação): O chamado nasceu e já tem técnico? SIM.
    // - Cenário B (Atualização): O técnico mudou? SIM.
    // - Cenário C (Atualização): O status mudou para 'atribuido'? SIM.
    
    const jaEstavaAtribuido = antigo && 
                              antigo.status === 'atribuido' && 
                              antigo.tecnico_id === novo.tecnico_id;
    
    // Se nada mudou na atribuição, não envia notificação (evita spam quando edita texto)
    if (jaEstavaAtribuido) return;

    try {
        // Buscar token do técnico
        const docTecnico = await db.collection('tecnicos').doc(novo.tecnico_id).get();
        if (!docTecnico.exists) return;
        
        const token = docTecnico.data().fcm_token;
        if (!token) {
            console.log(`Técnico ${novo.tecnico_nome} não tem token FCM.`);
            return;
        }

        const mensagem = {
            notification: { 
                title: '🚨 Chamado Atribuído!', 
                body: `${novo.endereco_elevador}` 
            },
            token: token
        };
        
        await admin.messaging().send(mensagem);
        console.log(`Notificação enviada para ${novo.tecnico_nome}!`);
        
    } catch (erro) {
        console.error("Erro notificação:", erro);
    }
});