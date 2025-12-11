/* eslint-disable no-unused-vars */
/* eslint-disable no-undef */

document.addEventListener('DOMContentLoaded', () => {
    const auth = firebase.auth();
    const db = firebase.firestore();
    const functions = firebase.functions();
    
    // Funções Callable
    const criarTecnicoCallable = functions.httpsCallable('criarTecnico');
    const criarChamadoManualCallable = functions.httpsCallable('criarChamadoManual');

    db.enablePersistence().catch(err => console.log("Persistência:", err.code));

    const state = { currentSection: '', editItemId: null, charts: {}, map: null };

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

    const calcDist = (lat1, lon1, lat2, lon2) => {
        const R = 6371; 
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
                  Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
                  Math.sin(dLon/2) * Math.sin(dLon/2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
        return R * c; 
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
            row.querySelector('.add-elev-btn')?.addEventListener('click', () => {
                openEditModal({ preselected_client_id: item.id, preselected_client_name: item.nome }, 'elevadores');
            });
        });
    };

    const closeModal = () => { ui.formModal.classList.add('hidden'); ui.genericForm.innerHTML = ''; state.editItemId = null; };
    
    const openModal = (title, formHtml, submitHandler) => {
        ui.formModalTitle.textContent = title;
        ui.genericForm.innerHTML = formHtml;
        ui.formModal.classList.remove('hidden');
        const cancelBtn = ui.genericForm.querySelector('.cancel-btn');
        if(cancelBtn) cancelBtn.addEventListener('click', closeModal); 
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
        ui.pageTitle.textContent = section === 'agenda' ? 'Agenda Preventiva' : section.charAt(0).toUpperCase() + section.slice(1);
        
        const template = document.getElementById(`${section}-template`);
        if (template) {
            ui.contentArea.innerHTML = template.innerHTML;
            if (section === 'clientes') loadClientesData();
            if (section === 'elevadores') loadElevadoresData();
            if (section === 'tecnicos') loadTecnicosData();
            if (section === 'chamados') loadChamadosData();
            if (section === 'dashboard') loadDashboardData();
            if (section === 'agenda') loadAgendaData();
        }
    };
    window.addEventListener('hashchange', () => loadSection(window.location.hash));
    ui.mainNav.addEventListener('click', (e) => { if(e.target.tagName === 'A') loadSection(e.target.getAttribute('href')); });

    // --- 1. CLIENTES ---
    const loadClientesData = async () => {
        showSpinner(); const snap = await db.collection('clientes').get(); hideSpinner();
        renderTable(snap.docs.map(d => ({id: d.id, ...d.data(), collection:'clientes'})), i => 
            `<td class="px-6 py-4">${i.nome}</td><td class="px-6 py-4">${i.possui_contrato?'Sim':'Não'}</td><td class="px-6 py-4 flex gap-2"><button class="bg-green-100 text-green-700 px-2 py-1 rounded text-xs font-bold hover:bg-green-200 add-elev-btn">+ Elevador</button><button class="edit-btn text-sky-600">Editar</button><button class="delete-btn text-red-600">Apagar</button></td>`);
        document.getElementById('add-btn').onclick = () => openEditModal(null);
    };

    // --- 2. ELEVADORES ---
    const loadElevadoresData = async () => {
        showSpinner(); const snap = await db.collection('elevadores').get(); hideSpinner();
        renderTable(snap.docs.map(d => ({id: d.id, ...d.data(), collection:'elevadores'})), i => 
            `<td class="px-6 py-4">${i.codigo_qr}</td><td class="px-6 py-4">${i.endereco}</td><td class="px-6 py-4">${i.cliente_nome||''}</td><td class="px-6 py-4"><button class="edit-btn text-sky-600">Editar</button><button class="delete-btn text-red-600 ml-4">Apagar</button></td>`);
        document.getElementById('add-btn').onclick = () => openEditModal(null);
    };

    // --- 3. TÉCNICOS ---
    const loadTecnicosData = async () => {
        showSpinner(); const snap = await db.collection('tecnicos').get(); hideSpinner();
        renderTable(snap.docs.map(d => ({id: d.id, ...d.data(), collection:'tecnicos'})), i => 
            `<td class="px-6 py-4">${i.nome}</td><td class="px-6 py-4 text-sm text-gray-500">${i.email||'N/A'}</td><td class="px-6 py-4"><label class="relative inline-flex items-center cursor-pointer"><input type="checkbox" value="" class="sr-only peer status-toggle" data-id="${i.id}" ${i.de_plantao ? 'checked' : ''}><div class="w-11 h-6 bg-gray-200 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600"></div><span class="ml-3 text-sm font-medium text-gray-900 status-text">${i.de_plantao ? 'On' : 'Off'}</span></label></td><td class="px-6 py-4"><button class="edit-btn text-sky-600">Editar</button><button class="delete-btn text-red-600 ml-4">Apagar</button></td>`);
        document.getElementById('add-btn').onclick = () => openEditModal(null);
        document.querySelectorAll('.status-toggle').forEach(t => t.addEventListener('change', async e => {
             try { await db.collection('tecnicos').doc(e.target.dataset.id).update({ de_plantao: e.target.checked }); showToast('Status atualizado!', 'success'); }
             catch (err) { showToast("Erro.", "error"); e.target.checked = !e.target.checked; }
        }));
    };

    // --- 4. CHAMADOS (TICKETS) ---
    const loadChamadosData = async (filters = {}) => {
        showSpinner();
        const [sTec, sCli, sEle] = await Promise.all([
            db.collection('tecnicos').get(), 
            db.collection('clientes').get(), 
            db.collection('elevadores').get()
        ]);
        
        const tecnicos = sTec.docs.map(d => ({id: d.id, nome: d.data().nome}));
        const clientes = sCli.docs.map(d => ({id: d.id, nome: d.data().nome}));
        const elevadores = sEle.docs.map(d => ({id: d.id, ...d.data()}));

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
            let duracaoMs = 0;
            if (dt.status === 'finalizado' && dt.data_finalizacao && dt.timestamp) {
                duracaoMs = (dt.data_finalizacao.seconds - dt.timestamp.seconds) * 1000;
            }
            return { 
                id: d.id, ...dt, 
                data_fmt: dt.timestamp ? new Date(dt.timestamp.seconds * 1000).toLocaleString() : 'N/A',
                duracao_txt: dt.status === 'finalizado' ? formatDuration(duracaoMs) : 'Em andamento'
            };
        });

        if(filters.data_inicio) data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) >= new Date(filters.data_inicio));
        if(filters.data_fim) { const f = new Date(filters.data_fim); f.setHours(23,59,59); data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) <= f); }
        if(filters.cliente_id) {
            const elevs = elevadores.filter(e => e.cliente_id === filters.cliente_id).map(e => e.id);
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

        setupButtonListeners(tecnicos, clientes, elevadores);
    };

    // --- AGENDA / ROTEIRIZAÇÃO ---
    const loadAgendaData = async () => {
        showSpinner();
        const [snapTec, snapElev] = await Promise.all([
            db.collection('tecnicos').get(),
            db.collection('elevadores').get()
        ]);
        const tecnicos = snapTec.docs.map(d => ({id: d.id, ...d.data()}));
        const elevadores = snapElev.docs.map(d => ({id: d.id, ...d.data()}));
        hideSpinner();

        const selTecnico = document.getElementById('agenda-tecnico');
        selTecnico.innerHTML = '<option value="">Selecione um Técnico...</option>';
        tecnicos.forEach(t => selTecnico.innerHTML += `<option value="${t.id}">${t.nome}</option>`);

        if (state.map) { state.map.remove(); state.map = null; }
        state.map = L.map('map').setView([-23.55, -46.63], 11);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap contributors' }).addTo(state.map);

        document.getElementById('btn-gerar-rota').onclick = () => {
            const tecId = selTecnico.value;
            if (!tecId) return alert("Selecione um técnico!");
            const tecnico = tecnicos.find(t => t.id === tecId);
            
            let startPoint = { lat: -23.55, lng: -46.63 };
            if (tecnico.localizacao_atual) { startPoint = { lat: tecnico.localizacao_atual.latitude, lng: tecnico.localizacao_atual.longitude }; }
            else if (tecnico.last_latitude) { startPoint = { lat: tecnico.last_latitude, lng: tecnico.last_longitude }; }

            let currentPos = startPoint;
            let unvisited = [...elevadores];
            let route = [];

            while (unvisited.length > 0) {
                let nearest = null; let minKm = Infinity; let nearestIndex = -1;
                unvisited.forEach((el, index) => {
                    if (el.localizacao) {
                        const d = calcDist(currentPos.lat, currentPos.lng, el.localizacao.latitude, el.localizacao.longitude);
                        if (d < minKm) { minKm = d; nearest = el; nearestIndex = index; }
                    }
                });
                if (nearest) { route.push(nearest); currentPos = { lat: nearest.localizacao.latitude, lng: nearest.localizacao.longitude }; unvisited.splice(nearestIndex, 1); } 
                else { break; }
            }
            drawRoute(startPoint, route);
        };

        const drawRoute = (start, route) => {
            state.map.eachLayer((layer) => { if (!layer._url) state.map.removeLayer(layer); });
            const ul = document.getElementById('lista-rota'); ul.innerHTML = '';
            const latlngs = [[start.lat, start.lng]];
            L.marker([start.lat, start.lng]).addTo(state.map).bindPopup("<b>Início</b>").openPopup();

            route.forEach((el, i) => {
                const lat = el.localizacao.latitude; const lng = el.localizacao.longitude;
                latlngs.push([lat, lng]);
                L.marker([lat, lng]).addTo(state.map).bindPopup(`<b>${i+1}. ${el.cliente_nome}</b><br>${el.endereco}`);
                const li = document.createElement('li');
                li.className = "p-3 bg-slate-50 rounded border border-slate-200 flex justify-between items-center";
                li.innerHTML = `<div><span class="font-bold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full text-xs mr-2">${i+1}</span><span class="font-medium text-sm">${el.cliente_nome}</span></div><a href="https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}" target="_blank" class="text-xs bg-gray-200 hover:bg-gray-300 px-2 py-1 rounded">📍 GPS</a>`;
                ul.appendChild(li);
            });
            L.polyline(latlngs, {color: 'blue', weight: 3, opacity: 0.7, dashArray: '5, 10'}).addTo(state.map);
            if (latlngs.length > 0) state.map.fitBounds(latlngs);
        };
    };

    // --- DASHBOARD (COM FILTROS E POPULATE) ---
    const loadDashboardData = async (filters={}) => {
        showSpinner();
        const [sTec, sCli, sEle] = await Promise.all([db.collection('tecnicos').get(), db.collection('clientes').get(), db.collection('elevadores').get()]);
        const elevadores = sEle.docs.map(d => ({id: d.id, ...d.data()}));
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
        if(filters.elevador_id) query = query.where('elevador_id', '==', filters.elevador_id);
        
        const snap = await query.get();
        let data = snap.docs.map(d => ({id: d.id, ...d.data()}));

        if(filters.data_inicio) data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) >= new Date(filters.data_inicio));
        if(filters.data_fim) { const f = new Date(filters.data_fim); f.setHours(23,59,59); data = data.filter(i => i.timestamp && new Date(i.timestamp.seconds*1000) <= f); }
        if(filters.cliente_id) {
            const elevs = elevadores.filter(e=>e.cliente_id===filters.cliente_id).map(e=>e.id);
            data = data.filter(c => elevs.includes(c.elevador_id));
        }

        hideSpinner();

        document.getElementById('total-chamados').textContent = data.length;
        document.getElementById('total-tecnicos').textContent = sTec.size;
        document.getElementById('total-elevadores').textContent = sEle.size;

        const statusCount = {aberto:0, atribuido:0, finalizado:0}; const tecnicoCount = {}; const timelineCount = {};
        data.forEach(c => {
            const st = c.status ? c.status.toLowerCase() : 'aberto';
            if(statusCount[st]!==undefined) statusCount[st]++;
            const nm = c.tecnico_nome || 'N/A';
            tecnicoCount[nm] = (tecnicoCount[nm]||0)+1;
            if(c.timestamp) {
                const d = new Date(c.timestamp.seconds*1000);
                const key = `${d.getMonth()+1}/${d.getFullYear()}`;
                timelineCount[key] = (timelineCount[key]||0)+1;
            }
        });

        renderChart('statusChart', 'doughnut', { labels: Object.keys(statusCount), datasets: [{ data: Object.values(statusCount), backgroundColor: ['#EF4444', '#EAB308', '#22C55E'] }] });
        renderChart('tecnicoChart', 'bar', { labels: Object.keys(tecnicoCount), datasets: [{ label:'Chamados', data: Object.values(tecnicoCount), backgroundColor: '#0EA5E9' }] }, {indexAxis:'y'});
        renderChart('mesChart', 'line', { labels: Object.keys(timelineCount).reverse(), datasets: [{ label:'Volume', data: Object.values(timelineCount).reverse(), borderColor: '#3B82F6' }] });

        document.getElementById('apply-filters-btn').onclick = () => {
            const filters = {
                data_inicio: document.getElementById('filter-data-inicio').value,
                data_fim: document.getElementById('filter-data-fim').value,
                cliente_id: document.getElementById('filter-cliente').value,
                elevador_id: document.getElementById('filter-elevador').value,
                tecnico_id: document.getElementById('filter-tecnico').value,
            };
            if(state.currentSection === 'dashboard') loadDashboardData(filters);
            else if(state.currentSection === 'chamados') loadChamadosData(filters);
        };
        document.getElementById('clear-filters-btn').onclick = () => { 
            const container = state.currentSection==='dashboard'?'dashboard-filters':'filters';
            document.getElementById(container).querySelectorAll('input, select').forEach(el=>el.value=''); 
            if(state.currentSection==='dashboard') loadDashboardData(); else loadChamadosData();
        };
    };

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
        
        const btnNovo = document.getElementById('btn-novo-chamado');
        if(btnNovo) {
            const newBtn = btnNovo.cloneNode(true);
            btnNovo.parentNode.replaceChild(newBtn, btnNovo);
            
            newBtn.onclick = async () => {
                const tecnicosOptions = tecnicos.map(t => `<option value="${t.id}">${t.nome}</option>`).join('');
                const clientesOptions = clientes.map(c => `<option value="${c.id}">${c.nome}</option>`).join('');
                
                ui.formModalTitle.textContent = "Novo Chamado";
                ui.formModal.classList.remove('hidden');
                
                ui.genericForm.innerHTML = `
                    <div class="mb-4 flex gap-4">
                        <label class="inline-flex items-center cursor-pointer"><input type="radio" name="tipo_cliente" value="registrado" checked class="form-radio text-blue-600" onchange="toggleForm(this.value)"><span class="ml-2 font-bold">Cliente Registrado</span></label>
                        <label class="inline-flex items-center cursor-pointer"><input type="radio" name="tipo_cliente" value="avulso" class="form-radio text-green-600" onchange="toggleForm(this.value)"><span class="ml-2 font-bold">Cliente Avulso</span></label>
                    </div>
                    <div id="area-registrado">
                        <div class="mb-2"><label class="block text-sm font-bold">Selecione o Cliente</label><select id="novo-cliente-select" class="w-full border p-2 rounded"><option value="">-- Selecione --</option>${clientesOptions}</select></div>
                        <div class="mb-2"><label class="block text-sm font-bold">Selecione o Elevador</label><select name="elevador_id" id="novo-elevador-select" class="w-full border p-2 rounded disabled:bg-gray-100" disabled><option value="">-- Selecione o Cliente Primeiro --</option></select></div>
                    </div>
                    <div id="area-avulso" class="hidden">
                        <div><label class="block text-sm font-bold">Nome do Cliente</label><input name="cliente" class="w-full border p-2 rounded mb-2" placeholder="Ex: Restaurante do João"></div>
                        <div><label class="block text-sm font-bold">Endereço Completo</label><input name="endereco" class="w-full border p-2 rounded mb-2" placeholder="Rua X, 123"></div>
                    </div>
                    <hr class="my-4 border-gray-200">
                    <div><label class="block text-sm font-bold">Descrição do Problema</label><textarea name="descricao" class="w-full border p-2 rounded mb-2" required></textarea></div>
                    <div><label class="block text-sm font-bold">Técnico (Opcional)</label><select name="tecnico_id" class="w-full border p-2 rounded mb-2"><option value="">-- Automático / Nenhum --</option>${tecnicosOptions}</select></div>
                    <div class="flex items-center mb-4"><input name="pessoa_presa" type="checkbox" class="h-4 w-4"><label class="ml-2 text-red-600 font-bold">Pessoa Presa?</label></div>
                    <div class="flex justify-end gap-2"><button type="button" class="cancel-btn bg-gray-300 px-4 py-2 rounded">Cancelar</button><button type="submit" class="bg-blue-600 text-white px-4 py-2 rounded">Criar Chamado</button></div>
                `;

                window.toggleForm = (tipo) => {
                    if (tipo === 'registrado') {
                        document.getElementById('area-registrado').classList.remove('hidden'); document.getElementById('area-avulso').classList.add('hidden');
                        document.querySelector('[name="cliente"]').value = ''; document.querySelector('[name="endereco"]').value = '';
                    } else {
                        document.getElementById('area-registrado').classList.add('hidden'); document.getElementById('area-avulso').classList.remove('hidden');
                        document.getElementById('novo-cliente-select').value = ''; document.getElementById('novo-elevador-select').innerHTML = '<option value="">-- Selecione --</option>'; document.getElementById('novo-elevador-select').disabled = true;
                    }
                };

                document.getElementById('novo-cliente-select').onchange = (e) => {
                    const clienteId = e.target.value; const elSelect = document.getElementById('novo-elevador-select');
                    if (!clienteId) { elSelect.innerHTML = '<option value="">-- Selecione --</option>'; elSelect.disabled = true; return; }
                    const elevs = elevadores.filter(el => el.cliente_id == clienteId);
                    elSelect.innerHTML = '<option value="">-- Selecione o Elevador --</option>';
                    elevs.forEach(el => { elSelect.innerHTML += `<option value="${el.id}">${el.endereco} (${el.codigo_qr})</option>`; });
                    elSelect.disabled = false;
                };

                ui.genericForm.querySelector('.cancel-btn').onclick = closeModal;
                ui.genericForm.onsubmit = async (e) => {
                    e.preventDefault(); const btnSubmit = ui.genericForm.querySelector('button[type="submit"]');
                    btnSubmit.disabled = true; btnSubmit.textContent = "A criar...";
                    const fd = new FormData(e.target); const d = Object.fromEntries(fd.entries());
                    const tipo = document.querySelector('input[name="tipo_cliente"]:checked').value;
                    if (tipo === 'registrado' && !d.elevador_id) { showToast("Selecione um elevador.", "error"); btnSubmit.disabled = false; return; }
                    try {
                        await criarChamadoManualCallable(d); showToast("Chamado criado!", "success"); closeModal(); loadChamadosData();
                    } catch (err) { showToast("Erro: " + (err.message || "Falha interna"), "error"); } 
                    finally { btnSubmit.disabled = false; }
                };
            };
        }
    };

    const renderChart = (id, type, data, opt={}) => {
        const ctx = document.getElementById(id); if(!ctx) return;
        if(state.charts[id]) state.charts[id].destroy();
        state.charts[id] = new Chart(ctx, {type, data, options: {responsive:true, maintainAspectRatio:false, ...opt}});
    };

    const openEditModal = async (item = null, sectionOverride = null) => {
        const section = sectionOverride || state.currentSection;
        const isEditing = item && item.id && !item.preselected_client_id;
        state.editItemId = isEditing ? item.id : null;
        let formHtml = '';
        
        if (section === 'tecnicos') {
            formHtml = `<div><label class="block text-sm">Nome</label><input name="nome" type="text" value="${item?.nome || ''}" required class="w-full border p-2 rounded mb-2"></div>
                <div><label class="block text-sm">E-mail</label><input name="email" type="email" value="${item?.email || ''}" required class="w-full border p-2 rounded mb-2" ${isEditing ? 'readonly' : ''}></div>
                <p class="text-xs text-gray-500">Crie o login no Console Firebase.</p>`;
        } else if (section === 'clientes') {
             formHtml = `<div><label class="block text-sm">Nome</label><input name="nome" type="text" value="${item?.nome || ''}" required class="w-full border p-2 rounded mb-2"></div>
                <div class="flex items-center"><input name="possui_contrato" type="checkbox" ${item?.possui_contrato ? 'checked' : ''} class="h-4 w-4 rounded"><label class="ml-2">Contrato Ativo</label></div>`;
        } else if (section === 'elevadores') {
             showSpinner();
             const snapCli = await db.collection('clientes').get();
             const clientes = snapCli.docs.map(d => ({id: d.id, nome: d.data().nome}));
             hideSpinner();
             const selectedCli = item?.cliente_id || item?.preselected_client_id || '';
             const options = clientes.map(c => `<option value="${c.id}" ${c.id === selectedCli ? 'selected' : ''}>${c.nome}</option>`).join('');
             formHtml = `<div><label class="block text-sm font-bold">Cliente</label><select name="cliente_id" id="form-cliente-select" class="w-full border p-2 rounded mb-2" required><option value="">Selecione...</option>${options}</select><input type="hidden" name="cliente_nome" id="form-cliente-nome"></div><div><label class="block text-sm">QR</label><input name="codigo_qr" type="text" value="${item?.codigo_qr || ''}" required class="w-full border p-2 rounded mb-2"></div><div><label class="block text-sm">Endereço</label><input name="endereco" type="text" value="${item?.endereco || ''}" required class="w-full border p-2 rounded mb-2"></div>`;
        }

        ui.genericForm.dataset.forcedCollection = sectionOverride || '';
        openModal(isEditing ? `Editar ${section}` : `Novo ${section}`, `${formHtml} <div class="pt-4 flex justify-end gap-4"><button type="button" class="cancel-btn bg-slate-200 px-4 py-2 rounded-lg">Cancelar</button><button type="submit" class="bg-sky-600 text-white px-4 py-2 rounded-lg">Salvar</button></div>`, handleFormSubmit);
        
        if(section === 'elevadores') {
            const sel = document.getElementById('form-cliente-select');
            if(sel) sel.onchange = (e) => { document.getElementById('form-cliente-nome').value = e.target.options[e.target.selectedIndex].text; };
            if(sel && sel.value) sel.onchange({target: sel});
        }
    };

    const handleFormSubmit = async (formData) => {
        const button = ui.genericForm.querySelector('button[type="submit"]'); button.disabled = true;
        const data = Object.fromEntries(formData.entries());
        const col = ui.genericForm.dataset.forcedCollection || state.currentSection;
        try {
            if (col === 'clientes') data.possui_contrato = !!data.possui_contrato;
            if (col === 'elevadores') {
                data.localizacao = new firebase.firestore.GeoPoint(0, 0);
                if(!data.cliente_nome) { const sel = document.getElementById('form-cliente-select'); data.cliente_nome = sel.options[sel.selectedIndex].text; }
            }
            if (state.editItemId) { const up = {...data}; delete up.password; await db.collection(col).doc(state.editItemId).update(up); } 
            else if (col === 'tecnicos') { data.de_plantao=false; data.fcm_token=null; data.last_latitude=null; data.last_longitude=null; await db.collection(col).add(data); } 
            else { await db.collection(col).add(data); }
            closeModal(); showToast("Salvo!", 'success'); 
            if (state.currentSection === 'clientes' && col === 'elevadores') { /* nada */ } else { await loadSection('#'+state.currentSection); }
        } catch (error) { showToast(error.message, 'error'); } finally { button.disabled = false; }
    };

    const handleDelete = async (id, collection) => { if(confirm(`Apagar?`)) { showSpinner(); await db.collection(collection).doc(id).delete(); hideSpinner(); loadSection('#'+state.currentSection); showToast("Apagado!"); } };
});
