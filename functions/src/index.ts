import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();

/**
 * 1. ROTA EXCLUSIVA PARA A IA (CHAMADA PELO SEU APP)
 */
export const obterDicaIA = functions.onRequest({ 
    region: "southamerica-east1", // Servidor de São Paulo
    cors: true // Mantemos sem a linha secrets para contornar a trava de faturamento do plano gratuito
}, async (req, res) => {
    
    // Verificação de segurança no log do servidor
   // Mude de process.env.GEMINI_KEY para process.env.API_KEY_GEMINI
    if (!process.env.API_KEY_GEMINI) {
        console.error("❌ ERRO: A variável API_KEY_GEMINI não foi carregada do arquivo .env!");
        res.status(500).json({ error: "Configuração de ambiente ausente no servidor." });
        return;
    }

    try {
        // Carrega a chave de forma segura a partir do arquivo .env local
        const apiKey = process.env.API_KEY_GEMINI; 
        
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        const modo = req.body?.modo || 'Geral';
        const saldo = req.body?.saldo || 0;
        const categorias = req.body?.categorias || {};

        console.log(`[Nova Versao] Solicitando dica de IA via .env para perfil: ${modo}`);

        const saldoNumerico = parseFloat(saldo as any) || 0;
        
        const categoriasTexto = (categorias && typeof categorias === 'object' && Object.keys(categorias).length > 0)
            ? JSON.stringify(categorias) 
            : "Nenhuma despesa cadastrada ainda";

        const prompt = `Aja como mentor financeiro do app Nós Dois & Eu. 
        Perfil: ${modo}. Saldo Atual: R$ ${saldoNumerico.toFixed(2)}. 
        Gastos por categoria: ${categoriasTexto}.
        Com base nesses dados, dê uma dica financeira muito curta (no máximo uma frase) e motivadora para este perfil.`;

        const result = await model.generateContent(prompt);
        
        if (!result.response || typeof result.response.text !== "function") {
            throw new Error("A API do Gemini não retornou uma função de texto válida.");
        }
        
        const text = result.response.text();
        
        if (!text) {
            throw new Error("O texto retornado pela IA veio vazio.");
        }
        
        res.status(200).json({ dica: text });

    } catch (error: any) {
        console.error("Erro na Function de IA:", error.message);
        res.status(500).json({ 
            dica: "A inteligência financeira está descansando um pouco. Tente novamente já já!",
            debug: error.message 
        });
    }
});

/**
 * 2. ROTA EXCLUSIVA PARA O WEBHOOK DO ASAAS (PAGAMENTOS)
 */
export const asaaswebhook = functions.onRequest({ 
    cors: true 
}, async (req, res) => {
    try {
        console.log("Webhook do Asaas recebido:", req.body.event);

        if (req.body.event === "PAYMENT_CONFIRMED") {
            const userId = req.body.payment.externalReference;
            
            if (!userId) {
                res.status(400).send("externalReference (userId) não encontrado no pagamento.");
                return;
            }

            await admin.firestore().collection("usuarios").doc(userId).update({
                plano: "premium",
                trialFim: null,
            });

            console.log(`Usuário ${userId} atualizado para Premium com sucesso!`);
            res.status(200).send("Pagamento Processado");
            return; 
        }

        res.status(200).send("Evento recebido, mas não processado (não era confirmação de pagamento).");

    } catch (error: any) {
        console.error("Erro no Webhook do Asaas:", error.message);
        res.status(500).send("Erro interno no servidor do webhook.");
    }
});