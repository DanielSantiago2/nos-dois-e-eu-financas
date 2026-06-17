import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();

/**
 * 1. ROTA EXCLUSIVA PARA A IA (CHAMADA PELO SEU APP)
 */
export const obterDicaIA = functions.onRequest({ 
    region: "southamerica-east1", // Servidor de São Paulo
    secrets: ["GEMINI_KEY"],
    cors: true 
}, async (req, res) => {
    
    // TESTE TEMPORÁRIO DE DIAGNÓSTICO
    if (!process.env.GEMINI_KEY) {
        console.error("❌ ERRO GRAVE: A variável GEMINI_KEY veio completamente VAZIA do servidor!");
        res.status(500).json({ error: "Ambiente não configurado no Cloud Secrets." });
        return; 
    }

    try {
        const apiKey = process.env.GEMINI_KEY;
        const genAI = new GoogleGenerativeAI(apiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
        
        // Pegando os dados de forma segura, garantindo fallback para objetos vazios
        const modo = req.body?.modo || 'Geral';
        const saldo = req.body?.saldo || 0;
        const categorias = req.body?.categorias || {};

        console.log(`[Nova Versao] Solicitando dica de IA para perfil: ${modo}`);

        const saldoNumerico = parseFloat(saldo as any) || 0;
        
        // Validação blindada: Só transforma em string se categorias for um objeto real
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