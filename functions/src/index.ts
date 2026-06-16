import * as functions from "firebase-functions/v2/https";
import * as admin from "firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";

admin.initializeApp();

/**
 * 1. ROTA EXCLUSIVA PARA A IA (CHAMADA PELO SEU APP)
 */
export const obterDicaIA = functions.onRequest({ 
    
    region: "southamerica-east1", // Mudamos para o servidor de São Paulo
    secrets: ["GEMINI_KEY"],
    cors: true 
}, async (req, res) => {
    
    // TESTE TEMPORÁRIO DE DIAGNÓSTICO
        if (!process.env.GEMINI_KEY) {
            console.error("❌ ERRO GRAVE: A variável GEMINI_KEY veio completamente VAZIA do servidor!");
        } else {
            console.log(`✅ Chave detectada! Ela começa com: ${process.env.GEMINI_KEY.substring(0, 5)}... e tem tamanho ${process.env.GEMINI_KEY.length}`);
        }
    
    // Configuração de CORS para o Front-end conseguir acessar
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }

    try {
        const apiKey = process.env.GEMINI_KEY;
        if (!apiKey) {
            throw new Error("A chave GEMINI_KEY não foi configurada nos secrets do Firebase.");
        }

        const genAI = new GoogleGenerativeAI(apiKey);
        
        // Mudamos para o modelo estável que aceita a rota direto
        const model = genAI.getGenerativeModel({
            model: "gemini-pro"
        });
        
       // Pegando os dados financeiros enviados pelo seu front-end
        const { modo, saldo, categorias } = req.body;

        console.log(`[Nova Versao] Solicitando dica de IA para perfil: ${modo || 'Geral'}`);

        // Forçamos a conversão do saldo para garantir que seja interpretado como número limpo
        const saldoNumerico = parseFloat(saldo) || 0;
        
        // Proteção extra: Garante que categorias seja uma string válida mesmo se vier vazio
        const categoriasTexto = categorias && Object.keys(categorias).length > 0 
            ? JSON.stringify(categorias) 
            : "Nenhuma despesa cadastrada ainda";

        const prompt = `Aja como mentor financeiro do app Nós Dois & Eu. 
        Perfil: ${modo || 'Geral'}. Saldo Atual: R$ ${saldoNumerico.toFixed(2)}. 
        Gastos por categoria: ${categoriasTexto}.
        Com base nesses dados, dê uma dica financeira muito curta (no máximo uma frase) e motivadora para este perfil.`;

        const result = await model.generateContent(prompt);
        
        // Validação correta de acordo com a tipagem da SDK do Gemini
        if (!result.response || typeof result.response.text !== "function") {
            throw new Error("A API do Gemini não retornou uma função de texto válida.");
        }
        
        // Extração correta do texto chamando o método contido em response
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
            return; // Encerra a execução aqui
        }

        // Se receber outro evento do Asaas que não seja confirmação, apenas avisa que recebeu
        res.status(200).send("Evento recebido, mas não processado (não era confirmação de pagamento).");

    } catch (error: any) {
        console.error("Erro no Webhook do Asaas:", error.message);
        res.status(500).send("Erro interno no servidor do webhook.");
    }
});