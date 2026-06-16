import { auth, loginEmail, criarConta, loginGoogle, resetarSenha, deslogar } from "./auth.js";
import { db, salvarTransacao, criarQueryTransacoes, deletarDoc, atualizarStatusDoc, salvarMeta, criarQueryMetas, deletarMetaDoc, vincularParceiro } from "./db.js";
import { renderHeader, toggleBotaoLoading, atualizarDashboard } from "./ui.js";
import { atualizarGrafico } from "./chart.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";
import { doc, getDoc, setDoc, onSnapshot, getDocs, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

let usuarioDados = {}; 
let unsubscribe = null; 

// --- CONFIGURAÇÃO DE CATEGORIAS DINÂMICAS ---
const categoriasPadrao = {
    despesa: ["Moradia", "Alimentação", "Pensão", "Saúde", "Assinatura", "Lazer", "Outros"],
    receita: ["Salário", "Extra", "Freelance", "Investimento", "Outros"]
};

window.atualizarCategorias = (tipo) => {
    const select = document.getElementById("categoria");
    if (!select) return;
    select.innerHTML = ""; 

    categoriasPadrao[tipo].forEach(cat => {
        const opt = document.createElement("option");
        opt.value = cat;
        opt.innerText = cat;
        select.appendChild(opt);
    });
};

const btnNovaCat = document.getElementById("btn-nova-categoria");
if (btnNovaCat) {
    btnNovaCat.onclick = async () => {
        const radioTipo = document.querySelector('input[name="tipo"]:checked');
        const tipo = radioTipo ? radioTipo.value : 'despesa';
        
        const { value: novaCat } = await Swal.fire({
            title: 'Nova Categoria',
            input: 'text',
            inputLabel: `Nome da categoria de ${tipo === 'despesa' ? 'Gasto' : 'Ganho'}`,
            showCancelButton: true,
            confirmButtonText: 'Adicionar',
            cancelButtonText: 'Cancelar'
        });

        if (novaCat) {
            const select = document.getElementById("categoria");
            const opt = document.createElement("option");
            opt.value = novaCat;
            opt.innerText = novaCat;
            select.appendChild(opt);
            select.value = novaCat; 
        }
    };
}

onAuthStateChanged(auth, async (user) => {
    const secaoLogin = document.getElementById("secao-login");
    const secaoApp = document.getElementById("secao-app");

    if (!user) {
        if (secaoLogin) secaoLogin.style.display = "block";
        if (secaoApp) secaoApp.style.display = "none";
        if (unsubscribe) unsubscribe();
        return;
    }
    
    if (secaoLogin) secaoLogin.style.display = "none";
    if (secaoApp) secaoApp.style.display = "block";

    const userRef = doc(db, "users", user.uid);
    const snap = await getDoc(userRef);
    
    if (!snap.exists()) {
        usuarioDados = { email: user.email, plano: "free", modo: "solteiro", groupId: null };
        await setDoc(userRef, usuarioDados);
    } else {
        usuarioDados = snap.data();
    }

    renderHeader(user, usuarioDados);
    initDataFlow(user);
    window.atualizarCategorias('despesa');
});

function initDataFlow(user) {
    const idGrupoBusca = usuarioDados.modo === "casal" ? usuarioDados.groupId : null;
    const q = criarQueryTransacoes(user.uid, idGrupoBusca);

    const btnSync = document.getElementById("btn-sync-manual");

    if (usuarioDados.plano === "free") {
        carregarDados(q);
        if (btnSync) btnSync.onclick = () => carregarDados(q);
    } else {
        if (unsubscribe) unsubscribe();
        unsubscribe = onSnapshot(q, (snapshot) => carregarDados(snapshot, true));
    }
}

async function carregarDados(queryRef, isSnapshot = false) {
    const snap = isSnapshot ? queryRef : await getDocs(queryRef);
    let totalR = 0, totalD = 0, html = "";
    const catMap = {};

    snap.forEach(docSnap => {
        const d = docSnap.data();
        const v = parseFloat(d.valor) || 0;
        v > 0 ? totalR += v : totalD += Math.abs(v);
        
        const catNome = d.categoria || "Outros";
        catMap[catNome] = (catMap[catNome] || 0) + Math.abs(v);

        html += `
            <div class="card ${v < 0 ? 'despesa' : 'receita'}">
                <div style="display:flex; justify-content: space-between">
                    <strong>${d.desc}</strong>
                    <span>R$ ${Math.abs(v).toFixed(2)}</span>
                </div>
                <div class="acoes">
                    <button class="mini-btn" onclick="window.alterarStatus('${docSnap.id}', ${d.pago})">${d.pago ? '✅' : '⏳'}</button>
                    <button class="mini-btn danger" onclick="window.excluirTransacao('${docSnap.id}')">🗑</button>
                </div>
            </div>`;
    });

    atualizarDashboard(totalR, totalD);
    const listaElem = document.getElementById("lista");
    if (listaElem) listaElem.innerHTML = html || "Vazio";
    
    atualizarGrafico(catMap);
    
    if (auth.currentUser) {
        carregarMetas(auth.currentUser.uid, (totalR - totalD));
    }

    // --- DISPARA A IA COM PROTEÇÃO DE FLUXO ---
    if (totalR > 0 || totalD > 0) {
        const resumoParaIA = {
            modo: usuarioDados.modo || "solteiro",
            saldo: (totalR - totalD).toFixed(2),
            categorias: catMap
        };
        atualizarDicaComIA(resumoParaIA);
    }
}

async function atualizarDicaComIA(dadosFinanceiros) {
    const painelDica = document.getElementById("dicas-financeiras");
    if (!painelDica) return;

    if (window.iaProcessando) return; 
    window.iaProcessando = true;

    try {
        // CORREÇÃO: Atualizado para a nova URL da 2ª Geração (Cloud Run)
        const response = await fetch("https://obterdicaia-xvab6uz5da-uc.a.run.app", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(dadosFinanceiros)
        });

        if (!response.ok) throw new Error(`Erro HTTP: ${response.status}`);
        const data = await response.json();
        painelDica.innerText = data.dica || "Mantenha o foco!";
    } catch (erro) {
        console.warn("IA indisponível:", erro.message);
        painelDica.innerText = "IA em repouso. Continue focado nas metas!";
    } finally {
        setTimeout(() => { window.iaProcessando = false; }, 8000); // Aumentado para 8s para evitar flood
    }
}

async function carregarMetas(uid, saldo) {
    const listaMetas = document.getElementById("lista-metas");
    if (!listaMetas) return;

    const snap = await getDocs(criarQueryMetas(uid));
    let html = "";
    snap.forEach(docSnap => {
        const m = docSnap.data();
        const obj = parseFloat(m.objetivo) || 1; // Evita divisão por zero
        let p = Math.min(100, Math.max(0, (saldo / obj) * 100));
        
        html += `
            <div class="meta-item" style="margin-bottom: 15px; padding: 10px; border-bottom: 1px solid #333;">
                <div style="display:flex; justify-content: space-between; align-items: center">
                    <strong>${m.nome}</strong>
                    <span style="font-size: 0.8rem; color: #888;">${p.toFixed(0)}%</span>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-sec); margin: 5px 0;">
                    R$ ${saldo.toFixed(2)} de R$ ${obj.toFixed(2)}
                </div>
                <div style="display:flex; align-items: center; gap: 10px;">
                    <div class="progresso-bg" style="flex-grow: 1; height: 10px; background: #222; border-radius: 5px; overflow: hidden;">
                        <div class="progresso-barra" style="width:${p}%; height: 100%; background: var(--cor-primaria); transition: width 0.3s"></div>
                    </div>
                    <button class="mini-btn danger" onclick="window.excluirMeta('${docSnap.id}')" style="padding: 2px 5px;">🗑</button>
                </div>
            </div>`;
    });
    listaMetas.innerHTML = html;
}

const selectModo = document.getElementById("select-modo");
if (selectModo) {
    selectModo.onchange = async () => {
        const novoModo = selectModo.value;
        const userRef = doc(db, "users", auth.currentUser.uid);
        try {
            toggleBotaoLoading("select-modo", true, ""); 
            await updateDoc(userRef, { modo: novoModo });
            await Swal.fire("Modo Alterado", `Agora você está no modo ${novoModo === 'casal' ? 'Casal' : 'Solteiro'}`, "success");
            location.reload(); 
        } catch (e) {
            Swal.fire("Erro", "Não foi possível mudar o modo", "error");
        }
    };
}

const btnSalvar = document.getElementById("btn-salvar");
if (btnSalvar) {
    btnSalvar.onclick = async () => {
        const desc = document.getElementById("desc").value;
        const valor = document.getElementById("valor").value;
        const radioTipo = document.querySelector('input[name="tipo"]:checked');
        const tipo = radioTipo ? radioTipo.value : 'despesa';
        const numParcelas = parseInt(document.getElementById("parcelas").value) || 1; 
        const vencElem = document.getElementById("vencimento").value;
        const dataInicial = vencElem ? new Date(vencElem) : new Date();

        if (!desc || !valor) {
            Swal.fire("Ops", "Preencha descrição e valor", "warning");
            return;
        }

        const gid = usuarioDados.modo === "casal" ? usuarioDados.groupId : null;
        toggleBotaoLoading("btn-salvar", true, "Salvando...");

        try {
            for (let i = 0; i < numParcelas; i++) {
                const dataParcela = new Date(dataInicial);
                dataParcela.setMonth(dataParcela.getMonth() + i); 

                await salvarTransacao(auth.currentUser.uid, gid, {
                    desc: numParcelas > 1 ? `${desc} (${i + 1}/${numParcelas})` : desc,
                    valor: Number(valor),
                    tipo,
                    categoria: document.getElementById("categoria").value,
                    data: dataParcela.toISOString().split('T')[0],
                    pago: false
                });
            }
            await Swal.fire("Sucesso", `${numParcelas} lançamento(s) realizados!`, "success");
            location.reload();
        } catch (e) {
            console.error(e);
            toggleBotaoLoading("btn-salvar", false, "Salvar");
        }
    };
}

window.excluirTransacao = async (id) => { if(confirm("Excluir?")) { await deletarDoc(id); location.reload(); }};
window.alterarStatus = async (id, s) => { await atualizarStatusDoc(id, s); location.reload(); };
window.excluirMeta = async (id) => { await deletarMetaDoc(id); location.reload(); };

const btnSalvarMeta = document.getElementById("btn-salvar-meta");
if (btnSalvarMeta) {
    btnSalvarMeta.onclick = async () => {
        const n = document.getElementById("meta-nome").value;
        const v = document.getElementById("meta-objetivo").value;
        if(n && v) { 
            await salvarMeta(auth.currentUser.uid, n, v); 
            location.reload(); 
        }
    };
}

// --- EVENTOS DE BOTÕES AUXILIARES ---
const addEvent = (id, event, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener(event, fn);
};

addEvent("btn-tema", "click", () => document.body.classList.toggle("light"));
addEvent("btn-sair", "click", deslogar);
addEvent("btn-login", "click", () => loginEmail(document.getElementById("email").value, document.getElementById("senha").value));
addEvent("btn-cadastrar", "click", () => criarConta(document.getElementById("email").value, document.getElementById("senha").value));
addEvent("btn-google", "click", loginGoogle);

addEvent("btn-conectar-parceiro", "click", async () => {
    const emailParceiro = document.getElementById("email-parceiro").value;
    try {
        await vincularParceiro(auth.currentUser.uid, emailParceiro);
        await Swal.fire("Sucesso", "Conectados!", "success");
        location.reload();
    } catch(e) { 
        Swal.fire("Erro", e.message, "error"); 
    }
});

addEvent("btn-pdf", "click", () => {
    const { jsPDF } = window.jspdf;
    const docPdf = new jsPDF();
    const canvas = document.getElementById("meuGrafico");

    docPdf.setFontSize(20);
    docPdf.setTextColor(37, 99, 235);
    docPdf.text("Relatório Nós Dois & Eu", 20, 20);
    
    docPdf.setFontSize(10);
    docPdf.setTextColor(100);
    docPdf.text(`Gerado por: ${usuarioDados.email || 'Usuário'}`, 20, 30);
    docPdf.text(`Data: ${new Date().toLocaleDateString()} | Modo: ${usuarioDados.modo}`, 20, 35);

    const receitas = document.getElementById("dinheiro")?.innerText || "0,00";
    const despesas = document.getElementById("contas")?.innerText || "0,00";
    const saldo = document.getElementById("falta")?.innerText || "0,00";

    docPdf.setDrawColor(200);
    docPdf.line(20, 42, 190, 42);
    docPdf.setFontSize(12);
    docPdf.setTextColor(0);
    docPdf.text(`Receitas: R$ ${receitas}`, 20, 52);
    docPdf.text(`Despesas: R$ ${despesas}`, 20, 60);
    docPdf.text(`Saldo Líquido: R$ ${saldo}`, 20, 68);

    if (canvas) {
        try {
            const graficoImagem = canvas.toDataURL("image/jpeg", 1.0); 
            docPdf.text("Distribuição por Categorias:", 20, 80);
            docPdf.addImage(graficoImagem, 'JPEG', 55, 85, 90, 90); 
        } catch (e) {
            docPdf.setTextColor(200, 0, 0);
            docPdf.text("Gráfico indisponível no momento", 20, 85);
        }
    }

    let y = 190; 
    docPdf.setTextColor(0);
    docPdf.text("Histórico de Transações:", 20, 185);
    
    const transacoes = document.querySelectorAll("#lista .card");
    transacoes.forEach((card, i) => {
        if (y > 275) { docPdf.addPage(); y = 20; }
        const info = card.innerText.split('\n')[0].trim();
        docPdf.setFontSize(9);
        docPdf.text(`${i + 1}. ${info}`, 20, y);
        y += 8;
    });

    docPdf.save(`Relatorio_VidaRica_${new Date().toLocaleDateString()}.pdf`);
});