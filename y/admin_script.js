/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

document.addEventListener('DOMContentLoaded', () => {
    const auth = firebase.auth();
    const db = firebase.firestore();
    const functions = firebase.functions();
    
    const criarTecnicoCallable = functions.httpsCallable('criarTecnico');
    const criarChamadoManualCallable = functions.httpsCallable('criarChamadoManual');

    db.enablePersistence().catch(err => console.log("Persistência:", err.code));

    const state = { currentSection: '', editItemId: null, charts: {} };

    const ui = {
        loginSection: document.getElementById('login-section'),
        mainPanel: document.getElementById('main-panel'),
        loginForm: document.getElementById('login-form'),
        logoutBtn: document.getElementById('logout-btn'),
        loginError: document.getElementById('login-error'),
        mainNav: document.getElementById('main-nav'),
        contentArea: document.getElementById('content-area'),
        pageTitle: document.getElementById('page-title'),
        formModal: document.getElementById('form-modal'),
        formModalTitle: document.getElementById('form-modal-title'),
        genericForm: document.getElementById('generic-form'),
        spinnerOverlay: document.getElementById('spinner-overlay'),
        toastContainer: document.getElementById('toast-container'),
    };

    // --- FUNÇÕES AUXILIARES ---
    const showSpinner = () => ui.spinnerOverlay.classList.remove('hidden');
    const hideSpinner = () => ui.spinnerOverlay.classList.add('hidden');
    const showToast = (msg, type = 'success') => {
        const toast = document.createElement('div');
        toast.className = `${type === 'success' ? 'bg-green-500' : 'bg-red-500'} text-white px-6 py-3 rounded-md shadow-lg animate-pulse`;
        toast.textContent = msg;
        ui.toastContainer.appendChild(toast);
        setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 3000);
    };
    const formatDuration = (ms) => {
        if (!ms) return '--';
        const minutes = Math.floor(ms / 60000);
        if (minutes < 60) return `${minutes}m`;
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours}h ${remainingMinutes}m`;
    };

    const renderTable = (data, rowRenderer) => {
        const tableBody = document.getElementById('data-table-body') || document.getElementById('chamados-table-body');
        if (!tableBody) return;
        tableBody.innerHTML = '';
        if (data.length === 0) { tableBody.innerHTML = '<tr><td colspan="6" class="px-6 py-4 text-center text-slate-500">Nenhum registo encontrado.</td></tr>'; return; }
        data.forEach(item => {
            const row = tableBody.insertRow();
            row.innerHTML = rowRenderer(item);
            row.querySelector('.edit-btn')?.addEventListener('click', () => openEditModal(item));
            row.querySelector('.delete-btn')?.addEventListener('click', () => handleDelete(item.id, item.collection));
        });
    };

    const closeModal = () => { ui.formModal.classList.add('hidden'); ui.genericForm.innerHTML = ''; state.editItemId = null; };
    const openModal = (title, formHtml, submitHandler) => {
        ui.formModalTitle.textContent = title;
        ui.genericForm.innerHTML = formHtml;
        ui.formModal.classList.remove('hidden');
        ui.genericForm.querySelector('.cancel-btn')?.addEventListener('click', closeModal); 
        ui.genericForm.onsubmit = async (e) => { e.preventDefault(); await submitHandler(new FormData(ui.genericForm)); };
    };
    
    // --- AUTH ---
    auth.onAuthStateChanged(user => {
        if (user) {
            user.getIdTokenResult().then((idTokenResult) => {
                if (idTokenResult.claims.role === 'admin') {
                    ui.loginSection.classList.add('hidden'); ui.mainPanel.classList.remove('hidden'); ui.mainPanel.style.display = 'flex';
                    loadSection(window.location.hash || '#dashboard');
                } else { alert('Acesso negado.'); auth.signOut(); }
            });
        } else { ui.mainPanel.classList.add('hidden'); ui.loginSection.classList.remove('hidden'); }
    });

    ui.loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('admin-username').value; 
        const pass = document.getElementById('admin-password').value;
        const finalEmail = email.includes('@') ? email : `${email}@upline.com`;
        try { await auth.signInWithEmailAndPassword(finalEmail, pass); } catch (error) { ui.loginError.textContent = "Erro: " + error.message; ui.loginError.classList.remove('hidden'); }
    });
    ui.logoutBtn.addEventListener('click', () => auth.signOut());

    // --- NAV ---
    const loadSection = async (hash) => {
        const section = hash.substring(1) || 'dashboard';
        state.currentSection = section;
        document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
        const activeLink = document.querySelector(`a[href="#${section}"]`);
        if (activeLink) activeLink.classList.add('active');
        ui.pageTitle.textContent = section.charAt(0).toUpperCase() + section.slice(1);
        const template = document.getElementById(`${section}-template`);
        if (template) {
            ui.contentArea.innerHTML = template.innerHTML;
            if (section === 'clientes') loadClientesData();
            if (section === 'elevadores') loadElevadoresData();
            if (section === 'tecnicos') loadTecnicosData();
            if (section === 'chamados') loadChamadosData();
            if (section === 'dashboard') loadDashboardData();
        }
    };
    window.addEventListener('hashchange', () => loadSection(window.location.hash));
    ui.mainNav.addEventListener('click', (e) => { if(e.target.tagName === 'A') loadSection(e.target.getAttribute('href')); });

    // --- CRUD BÁSICO ---
    const loadClientesData = async () => {
        showSpinner(); const snap = await db.collection('clientes').get(); hideSpinner();
        renderTable(snap.docs.map(d => ({id: d.id, ...d.data(), collection:'clientes'})), i => 
            `<td class="px-6 py-4">${i.nome}</td><td class="px-6 py-4">${i.possui_contrato?'Sim':'Não'}</td><td class="px-6 py-4"><button class="edit-btn text-sky-600">Editar</button><button class="delete-btn text-red-600 ml-4">Apagar</button></td>`);
        document.getElementById('add-btn').onclick = () => openEditModal(null);
    };
    const loadElevadoresData = async () => {
        showSpinner(); const snap = await db.collection('elevadores').get(); hideSpinner();
        renderTable(snap.docs.map(d => ({id: d.id, ...d.data(), collection:'elevadores'})), i => 
            `<td class="px-6 py-4">${i.codigo_qr}</td><td class="px-6 py-4">${i.endereco}</td><td class="px-6 py-4">${i.cliente_nome||''}</td><td class="px-6 py-4"><button class="edit-btn text-sky-600">Editar</button><button class="delete-btn text-red-600 ml-4">Apagar</button></td>`);
        document.getElementById('add-btn').onclick = () => openEditModal(null);
    };
    const loadTecnicosData = async () => {
        showSpinner(); const snap = await db.collection('tecnicos').get(); hideSpinner();
        renderTable(snap.docs.map(d => ({id: d.id, ...d.data(), collection:'tecnicos'})), i => 
            `<td class="px-6 py-4">${i.nome}</td><td class="px-6 py-4 text-sm text-gray-500">${i.email||'N/A'}</td><td class="px-6 py-4">${i.de_plantao?'<span class="bg-green-100 rounded px-2 text-xs">On</span>':'<span class="bg-gray-100 rounded px-2 text-xs">Off</span>'}</td><td class="px-6 py-4"><button class="edit-btn text-sky-600">Editar</button><button class="delete-btn text-red-600 ml-4">Apagar</button></td>`);
        document.getElementById('add-btn').onclick = () => openEditModal(null);
    };

    // --- CHAMADOS (TICKETS) - Duração por Chamado ---
    const loadChamadosData = async (filters = {}) => {
        showSpinner();
        const [sTec, sCli, sEle] = await Promise.all([db.collection('tecnicos').get(), db.collection('clientes').get(), db.collection('elevadores').get()]);
        const tecnicos = sTec.docs.map(d => ({id: d.id, nome: d.data().nome}));
        const elevadores = sEle.docs.map(d => ({id: d.id, ...d.data()}));
        const clientes = sCli.docs.map(d => ({id: d.id, nome: d.data().nome}));

        const populateSelect = (id, data, v, t) => {
            const s = document.getElementById(id); if(!s) return;
            const val = filters[id.replace('filter-','')+'_id'] || s.value;
            s.innerHTML='<option value="">Todos</option>';
            data.forEach(i=>s.innerHTML+=`<option value="${i[v]}">${i[t]}</option>`);
            s.value = val;
        };
        populateSelect('filter-cliente', clientes, 'id', 'nome');
        populateSelect('filter-elevador', elevadores, 'id', 'endereco');
        populateSelect('filter-tecnico', tecnicos, 'id', 'nome');

        let query = db.collection('chamados');
        if(filters.tecnico_id) query = query.where('tecnico_id', '==', filters.tecnico_id);
        if(filters.elevador_id) query = query.where('elevador_id', '==', filters.elevador_id);
        query = query.orderBy('timestamp', 'desc').limit(100);

        const snap = await query.get();
        let data = snap.docs.map(d => {
            const dt = d.data();
            // Cálculo de Duração Individual
            let duracaoMs = 0;
            if (dt.status === 'finalizado' && dt.data_finalizacao && dt.timestamp) {
                duracaoMs = (dt.data_finalizacao.seconds - dt.timestamp.seconds) * 1000;
            }
            return { 
                id: d.id, ...dt, 
                data_fmt: dt.timestamp ? new Date(dt.timestamp.seconds * 1000).toLocaleString() : 'N/A',
                duracao_ms: duracaoMs,
                duracao_txt: dt.status === 'finalizado' ? formatDuration(duracaoMs) : 'Em andamento'
            };
        });

        // Filtros Client-Side
        if(filters.data_inicio) data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) >= new Date(filters.data_inicio));
        if(filters.data_fim) { const f = new Date(filters.data_fim); f.setHours(23,59,59); data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) <= f); }
        if(filters.cliente_id) {
            const elevs = elevadores.filter(e=>e.cliente_id===filters.cliente_id).map(e=>e.id);
            data = data.filter(c => elevs.includes(c.elevador_id));
        }

        hideSpinner();

        renderTable(data, item => {
            let actionHtml = item.tecnico_nome || 'N/A';
            const colors = { 'aberto': 'bg-red-100 text-red-800', 'atribuido': 'bg-yellow-100 text-yellow-800', 'finalizado': 'bg-green-100 text-green-800' };
            
            if (item.status !== 'finalizado') {
                const opts = tecnicos.map(t => `<option value="${t.id}" ${t.id===item.tecnico_id?'selected':''}>${t.nome}</option>`).join('');
                actionHtml = `<div class="flex gap-1"><select id="sel-${item.id}" class="border text-xs rounded w-24"><option value="">--</option>${opts}</select><button class="bg-sky-500 text-white px-2 rounded text-xs assign-btn" data-id="${item.id}">OK</button></div>`;
            } else {
                const dias = item.data_finalizacao ? Math.ceil((new Date() - new Date(item.data_finalizacao.seconds*1000))/(86400000)) : 999;
                if (dias <= 30) actionHtml = `<div class="text-xs text-green-700 font-bold">${item.tecnico_nome}</div><button class="bg-orange-500 text-white px-2 py-0.5 rounded text-[10px] reabrir-btn" data-id="${item.id}">Reabrir</button>`;
                else actionHtml = `<span class="text-green-700 text-xs">${item.tecnico_nome}</span>`;
            }

            return `
                <td class="px-6 py-4 font-bold text-gray-700 text-xs">#${item.id.substring(0,5)}</td>
                <td class="px-6 py-4"><span class="px-2 py-1 rounded-full text-xs font-semibold ${colors[item.status]||''}">${item.status.toUpperCase()}</span></td>
                <td class="px-6 py-4 text-xs max-w-xs truncate text-gray-500">${item.endereco_elevador||'N/A'}<br><span class="text-[10px] text-gray-400">${item.descricao_problema}</span></td>
                <td class="px-6 py-4 text-xs font-mono text-blue-600 font-bold">${item.duracao_txt}</td>
                <td class="px-6 py-4 text-xs">${actionHtml}</td>
                <td class="px-6 py-4 text-xs text-gray-500">${item.data_fmt}</td>
            `;
        });

        // Passamos também clientes e elevadores
        setupButtonListeners(tecnicos, clientes, elevadores);
    };

    // Função auxiliar para listeners
    const setupButtonListeners = (tecnicos, clientes, elevadores) => {
        document.querySelectorAll('.assign-btn').forEach(b => b.onclick = async (e) => {
            const id = e.target.dataset.id;
            const tecId = document.getElementById(`sel-${id}`).value;
            const tecNome = document.getElementById(`sel-${id}`).options[document.getElementById(`sel-${id}`).selectedIndex].text;
            if(!tecId) return;
            showSpinner(); await db.collection('chamados').doc(id).update({status:'atribuido', tecnico_id:tecId, tecnico_nome:tecNome}); hideSpinner(); loadChamadosData();
        });
        document.querySelectorAll('.reabrir-btn').forEach(b => b.onclick = async (e) => {
            if(confirm("Reabrir?")) { showSpinner(); await db.collection('chamados').doc(e.target.dataset.id).update({status:'aberto', tecnico_id:null, tecnico_nome:null, data_finalizacao:null}); hideSpinner(); loadChamadosData(); }
        });
        
        // Botão Novo Chamado
        // Botão "Novo Chamado" (Registrado ou Avulso)
        const btnNovo = document.getElementById('btn-novo-chamado');
        if(btnNovo) {
            // Atualiza o texto do botão para ser genérico
            btnNovo.innerHTML = '<span class="mr-2 text-xl">+</span> Novo Chamado';
            
            const newBtn = btnNovo.cloneNode(true);
            btnNovo.parentNode.replaceChild(newBtn, btnNovo);
            
            newBtn.onclick = async () => {
                const tecnicosOptions = tecnicos.map(t => `<option value="${t.id}">${t.nome}</option>`).join('');
                // Prepara opções de Clientes para o dropdown
                const clientesOptions = clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
                
                ui.formModalTitle.textContent = "Novo Chamado";
                ui.formModal.classList.remove('hidden');
                
                ui.genericForm.innerHTML = `
                    <div class="mb-4 flex gap-4">
                        <label class="inline-flex items-center cursor-pointer">
                            <input type="radio" name="tipo_cliente" value="registrado" checked class="form-radio text-blue-600" onchange="toggleForm(this.value)">
                            <span class="ml-2 font-bold">Cliente Registrado</span>
                        </label>
                        <label class="inline-flex items-center cursor-pointer">
                            <input type="radio" name="tipo_cliente" value="avulso" class="form-radio text-green-600" onchange="toggleForm(this.value)">
                            <span class="ml-2 font-bold">Cliente Avulso</span>
                        </label>
                    </div>

                    <div id="area-registrado">
                        <div class="mb-2">
                            <label class="block text-sm font-bold">Selecione o Cliente</label>
                            <select id="novo-cliente-select" class="w-full border p-2 rounded">
                                <option value="">-- Selecione --</option>
                                ${clientesOptions}
                            </select>
                        </div>
                        <div class="mb-2">
                            <label class="block text-sm font-bold">Selecione o Elevador</label>
                            <select name="elevador_id" id="novo-elevador-select" class="w-full border p-2 rounded disabled:bg-gray-100" disabled>
                                <option value="">-- Selecione o Cliente Primeiro --</option>
                            </select>
                        </div>
                    </div>

                    <div id="area-avulso" class="hidden">
                        <div><label class="block text-sm font-bold">Nome do Cliente</label><input name="cliente" class="w-full border p-2 rounded mb-2" placeholder="Ex: Restaurante do João"></div>
                        <div><label class="block text-sm font-bold">Endereço Completo</label><input name="endereco" class="w-full border p-2 rounded mb-2" placeholder="Rua X, 123"></div>
                    </div>

                    <hr class="my-4 border-gray-200">
                    <div><label class="block text-sm font-bold">Descrição do Problema</label><textarea name="descricao" class="w-full border p-2 rounded mb-2" required></textarea></div>
                    <div><label class="block text-sm font-bold">Técnico (Opcional)</label>
                        <select name="tecnico_id" class="w-full border p-2 rounded mb-2">
                            <option value="">-- Automático / Nenhum --</option>
                            ${tecnicosOptions}
                        </select>
                    </div>
                    <div class="flex items-center mb-4"><input name="pessoa_presa" type="checkbox" class="h-4 w-4"><label class="ml-2 text-red-600 font-bold">Pessoa Presa?</label></div>
                    
                    <div class="flex justify-end gap-2">
                        <button type="button" class="cancel-btn bg-gray-300 px-4 py-2 rounded">Cancelar</button>
                        <button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded">Criar Chamado</button>
                    </div>
                `;

                // LÓGICA DO FORMULÁRIO DINÂMICO
                
                // 1. Toggle entre Registrado/Avulso
                window.toggleForm = (tipo) => {
                    if (tipo === 'registrado') {
                        document.getElementById('area-registrado').classList.remove('hidden');
                        document.getElementById('area-avulso').classList.add('hidden');
                        // Limpa campos avulsos para não enviar lixo
                        document.querySelector('[name="cliente"]').value = '';
                        document.querySelector('[name="endereco"]').value = '';
                    } else {
                        document.getElementById('area-registrado').classList.add('hidden');
                        document.getElementById('area-avulso').classList.remove('hidden');
                        // Reseta selects
                        document.getElementById('novo-cliente-select').value = '';
                        document.getElementById('novo-elevador-select').innerHTML = '<option value="">-- Selecione o Cliente Primeiro --</option>';
                        document.getElementById('novo-elevador-select').disabled = true;
                    }
                };

                // 2. Carregar elevadores quando cliente muda
                document.getElementById('novo-cliente-select').onchange = (e) => {
                    const clienteId = e.target.value;
                    const elSelect = document.getElementById('novo-elevador-select');
                    
                    if (!clienteId) {
                        elSelect.innerHTML = '<option value="">-- Selecione o Cliente Primeiro --</option>';
                        elSelect.disabled = true;
                        return;
                    }

                    // Filtra elevadores deste cliente (usando a lista 'elevadores' que já temos carregada)
                    const elevadoresDoCliente = elevadores.filter(el => el.cliente_id == clienteId); // '==' para garantir
                    
                    elSelect.innerHTML = '<option value="">-- Selecione o Elevador --</option>';
                    elevadoresDoCliente.forEach(el => {
                        elSelect.innerHTML += `<option value="${el.id}">${el.endereco} (${el.codigo_qr})</option>`;
                    });
                    elSelect.disabled = false;
                };

                ui.genericForm.querySelector('.cancel-btn').onclick = closeModal;
                
                ui.genericForm.onsubmit = async (e) => {
                    e.preventDefault();
                    const btnSubmit = ui.genericForm.querySelector('button[type="submit"]');
                    btnSubmit.disabled = true; 
                    btnSubmit.textContent = "A criar...";
                    
                    const fd = new FormData(e.target);
                    const d = Object.fromEntries(fd.entries());

                    // Validação manual simples
                    const tipo = document.querySelector('input[name="tipo_cliente"]:checked').value;
                    if (tipo === 'registrado' && !d.elevador_id) {
                        showToast("Por favor, selecione um elevador.", "error");
                        btnSubmit.disabled = false;
                        btnSubmit.textContent = "Criar Chamado";
                        return;
                    }

                    try {
                        const criarChamadoManualCallable = firebase.functions().httpsCallable('criarChamadoManual');
                        await criarChamadoManualCallable(d);
                        showToast("Chamado criado com sucesso!", "success");
                        closeModal();
                        loadChamadosData();
                    } catch (err) {
                        console.error(err);
                        showToast("Erro: " + (err.message || "Falha interna"), "error");
                    } finally {
                        btnSubmit.disabled = false;
                        btnSubmit.textContent = "Criar Chamado";
                    }
                };
            };
        }
        // Filtros
        document.getElementById('apply-filters-btn').onclick = () => {
            loadChamadosData({
                data_inicio: document.getElementById('filter-data-inicio').value,
                data_fim: document.getElementById('filter-data-fim').value,
                cliente_id: document.getElementById('filter-cliente').value,
                elevador_id: document.getElementById('filter-elevador').value,
                tecnico_id: document.getElementById('filter-tecnico').value,
            });
        };
        document.getElementById('clear-filters-btn').onclick = () => { document.getElementById('filters').querySelectorAll('input, select').forEach(el=>el.value=''); loadChamadosData(); };
    };

    // --- DASHBOARD (SEM CÁLCULOS DE MÉDIA) ---
    const loadDashboardData = async (filters={}) => {
        showSpinner();
        const [sTec, sCli, sEle] = await Promise.all([db.collection('tecnicos').get(), db.collection('clientes').get(), db.collection('elevadores').get()]);
        const elevadores = sEle.docs.map(d => ({id: d.id, ...d.data()}));
        // Populate Selects... (igual ao loadChamadosData)
        const tecnicos = sTec.docs.map(d => ({id: d.id, nome: d.data().nome}));
        const clientes = sCli.docs.map(d => ({id: d.id, nome: d.data().nome}));

        const populateSelect = (id, data, v, t) => {
            const s = document.getElementById(id); if(!s) return;
            const val = filters[id.replace('filter-','')+'_id'] || s.value;
            s.innerHTML='<option value="">Todos</option>';
            data.forEach(i=>s.innerHTML+=`<option value="${i[v]}">${i[t]}</option>`);
            s.value = val;
        };
        populateSelect('filter-cliente', clientes, 'id', 'nome');
        populateSelect('filter-elevador', elevadores, 'id', 'endereco');
        populateSelect('filter-tecnico', tecnicos, 'id', 'nome');

        let query = db.collection('chamados').orderBy('timestamp', 'desc').limit(300);
        if(filters.tecnico_id) query = query.where('tecnico_id', '==', filters.tecnico_id);
        
        const snap = await query.get();
        let data = snap.docs.map(d => ({id: d.id, ...d.data()}));

        // Filtros Client-Side (Mesma lógica)
        if(filters.data_inicio) data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) >= new Date(filters.data_inicio));
        if(filters.data_fim) { const f = new Date(filters.data_fim); f.setHours(23,59,59); data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) <= f); }
        if(filters.cliente_id) {
            const elevs = elevadores.filter(e=>e.cliente_id===filters.cliente_id).map(e=>e.id);
            data = data.filter(c => elevs.includes(c.elevador_id));
        }

        hideSpinner();

        // --- CÁLCULOS DO DASHBOARD ---
        const statusCount = {aberto:0, atribuido:0, finalizado:0};
        const tecnicoCount = {};
        const timelineCount = {};

        data.forEach(c => {
            const st = c.status ? c.status.toLowerCase() : 'aberto';
            if(statusCount[st]!==undefined) statusCount[st]++;
            const nm = c.tecnico_nome || 'N/A';
            tecnicoCount[nm] = (tecnicoCount[nm]||0)+1;
            if(c.timestamp) {
                const d = new Date(c.timestamp.seconds*1000);
                timelineCount[`${d.getMonth()+1}/${d.getFullYear()}`] = (timelineCount[`${d.getMonth()+1}/${d.getFullYear()}`]||0)+1;
            }
        });

        document.getElementById('total-chamados').textContent = data.length;
        document.getElementById('total-tecnicos').textContent = sTec.size;
        document.getElementById('total-elevadores').textContent = sEle.size;

        // Gráficos
        renderChart('statusChart', 'doughnut', { labels: ['Aberto', 'Atribuído', 'Finalizado'], datasets: [{ data: Object.values(statusCount), backgroundColor: ['#EF4444', '#EAB308', '#22C55E'] }] });
        renderChart('tecnicoChart', 'bar', { labels: Object.keys(tecnicoCount), datasets: [{ label:'Chamados', data: Object.values(tecnicoCount), backgroundColor: '#0EA5E9' }] }, {indexAxis:'y'});
        renderChart('mesChart', 'line', { labels: Object.keys(timelineCount).reverse(), datasets: [{ label:'Volume', data: Object.values(timelineCount).reverse(), borderColor: '#3B82F6' }] });

        document.getElementById('apply-filters-btn').onclick = () => {
            loadDashboardData({
                data_inicio: document.getElementById('filter-data-inicio').value,
                data_fim: document.getElementById('filter-data-fim').value,
                cliente_id: document.getElementById('filter-cliente').value,
                elevador_id: document.getElementById('filter-elevador').value,
                tecnico_id: document.getElementById('filter-tecnico').value,
            });
        };
        document.getElementById('clear-filters-btn').onclick = () => { document.getElementById('dashboard-filters').querySelectorAll('input, select').forEach(el=>el.value=''); loadDashboardData(); };
    };

    const renderChart = (id, type, data, opt={}) => {
        const ctx = document.getElementById(id);
        if(!ctx) return;
        if(state.charts[id]) state.charts[id].destroy();
        state.charts[id] = new Chart(ctx, {type, data, options: {responsive:true, maintainAspectRatio:false, ...opt}});
    };

    const openEditModal = (item = null) => { /* ... Lógica de edição inalterada ... */ 
        const isEditing = item !== null;
        state.editItemId = item ? item.id : null; 
        const section = state.currentSection;
        let formHtml = '';
        
        if (section === 'tecnicos') {
            formHtml = `<div><label class="block text-sm">Nome</label><input name="nome" type="text" value="${item?.nome || ''}" required class="w-full border p-2 rounded mb-2"></div>
                <div><label class="block text-sm">E-mail</label><input name="email" type="email" value="${item?.email || ''}" required class="w-full border p-2 rounded mb-2" ${isEditing ? 'readonly' : ''}></div>
                <p class="text-xs text-gray-500">Crie o login no Console Firebase.</p>`;
        } else if (section === 'clientes') {
             formHtml = `<div><label class="block text-sm">Nome</label><input name="nome" type="text" value="${item?.nome || ''}" required class="w-full border p-2 rounded mb-2"></div>
                <div class="flex items-center"><input name="possui_contrato" type="checkbox" ${item?.possui_contrato ? 'checked' : ''} class="h-4 w-4 rounded"><label class="ml-2">Contrato Ativo</label></div>`;
        } else if (section === 'elevadores') {
             formHtml = `<div><label class="block text-sm">QR</label><input name="codigo_qr" type="text" value="${item?.codigo_qr || ''}" required class="w-full border p-2 rounded mb-2"></div>
                <div><label class="block text-sm">Endereço</label><input name="endereco" type="text" value="${item?.endereco || ''}" required class="w-full border p-2 rounded mb-2"></div>`;
        }

        openModal(isEditing ? `Editar ${section}` : `Novo ${section}`, 
            `${formHtml} <div class="pt-4 flex justify-end gap-4"><button type="button" class="cancel-btn bg-slate-200 px-4 py-2 rounded-lg">Cancelar</button><button type="submit" class="bg-sky-600 text-white px-4 py-2 rounded-lg">Salvar</button></div>`, handleFormSubmit
        );
    };
    
    const handleFormSubmit = async (formData) => { /* ... Lógica de submit inalterada ... */ 
        const button = ui.genericForm.querySelector('button[type="submit"]');
        button.disabled = true;
        const data = Object.fromEntries(formData.entries());
        const col = state.currentSection;
        try {
            if (col === 'clientes') data.possui_contrato = !!data.possui_contrato;
            if (state.editItemId) {
                const up = {...data}; delete up.password;
                await db.collection(col).doc(state.editItemId).update(up);
            } else if (col === 'tecnicos') {
                data.de_plantao=false; data.fcm_token=null; data.last_latitude=null; data.last_longitude=null;
                await db.collection(col).add(data);
            } else {
                await db.collection(col).add(data);
            }
            closeModal(); showToast("Salvo!", 'success'); await loadSection('#'+col);
        } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
    };
    
    const handleDelete = async (id, collection) => { /* ... Lógica de delete inalterada ... */ 
        if(confirm(`Apagar?`)) { showSpinner(); await db.collection(collection).doc(id).delete(); hideSpinner(); loadSection('#'+state.currentSection); showToast("Apagado!"); }
    };
});