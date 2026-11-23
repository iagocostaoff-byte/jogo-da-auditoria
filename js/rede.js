/* ==================================================================
   Trilha de Auditoria · rede.js
   Liga a TV (moderador) aos celulares das equipes.

   Modos, escolhidos nesta ordem:
   - "firebase": se js/firebase-config.js estiver preenchido, usa o
     Firebase Realtime Database.
   - "online": sem Firebase, usa um servidor público e gratuito de
     mensagens (MQTT via WebSocket), sem cadastro. Funciona com
     celulares em qualquer rede. Se um servidor falhar, tenta o próximo.
   - "local": só para testes (?modo=local): TV e "celulares" como abas
     do mesmo navegador.
   Se nada funcionar, o jogo roda só na TV.
   Licença MIT.
   ================================================================== */
(function(){
  const Rede = { modo: 'off', erro: null, brokerIdx: 0 };
  let db = null;
  const params = new URLSearchParams(location.search);

  /* Servidores públicos de MQTT (WebSocket seguro). A TV usa o primeiro
     que responder e avisa os celulares pelo QR code (parâmetro b). */
  Rede.BROKERS = [
    'wss://broker.emqx.io:8084/mqtt',
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://test.mosquitto.org:8081/mqtt'
  ];
  const BASE = 'trilha-auditoria-facc/v1/';
  if(params.get('broker')) Rede.BROKERS = [params.get('broker')];   // só para testes

  Rede.init = function(){
    try{
      const cfg = window.FIREBASE_CONFIG;
      if(cfg && cfg.databaseURL && window.firebase && firebase.initializeApp){
        const app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(cfg);
        db = app.database();
        Rede.modo = 'firebase';
        return Rede.modo;
      }
    }catch(e){ Rede.erro = String(e && e.message || e); }
    try{
      if(params.get('modo') === 'local' && 'BroadcastChannel' in window){ Rede.modo = 'local'; return Rede.modo; }
      if(window.mqtt && location.protocol !== 'file:'){ Rede.modo = 'online'; return Rede.modo; }
      if('BroadcastChannel' in window && location.protocol !== 'file:'){ Rede.modo = 'local'; return Rede.modo; }
    }catch(e){}
    Rede.modo = 'off';
    return Rede.modo;
  };

  Rede.novoCodigo = function(){
    const L = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    let s = '';
    for(let i = 0; i < 4; i++) s += L[Math.floor(Math.random() * L.length)];
    return s;
  };

  /* O que vai no link do QR code além do código da sala */
  Rede.extrasConvite = function(){
    let q = '';
    if(Rede.modo === 'online') q += '&b=' + Rede.brokerIdx;
    if(params.get('broker')) q += '&broker=' + encodeURIComponent(params.get('broker'));
    if(Rede.modo === 'local') q += '&modo=local';
    return q;
  };

  /* ---------------- TV ---------------- */
  Rede.hospedar = function(sala, cb){
    if(Rede.modo === 'firebase') return hospedarFirebase(sala, cb);
    if(Rede.modo === 'online') return hospedarOnline(sala, cb);
    if(Rede.modo === 'local') return hospedarLocal(sala, cb);
    return { publicar(){}, encerrar(){} };
  };

  function hospedarFirebase(sala, cb){
    const ref = db.ref('salas/' + sala);
    const falha = e => cb.onErro && cb.onErro(e);
    ref.child('meta').update({ criada: firebase.database.ServerValue.TIMESTAMP }).catch(falha);
    const onPlayers = s => cb.onJogadores && cb.onJogadores(s.val() || {});
    ref.child('jogadores').on('value', onPlayers, falha);
    const onMsg = s => { const m = s.val(); s.ref.remove(); if(m && cb.onMensagem) cb.onMensagem(m); };
    ref.child('msgs').on('child_added', onMsg, falha);
    if(cb.onConexao){
      db.ref('.info/connected').on('value', s => cb.onConexao(!!s.val()));
    }
    return {
      publicar(estado){ ref.child('estado').set(estado).catch(falha); },
      encerrar(){
        ref.child('jogadores').off('value', onPlayers);
        ref.child('msgs').off('child_added', onMsg);
        ref.child('estado').set({ fase: 'encerrada' });
      }
    };
  }

  /* Conecta ao primeiro servidor MQTT que responder, a partir de 'inicio' */
  function conectarMqtt(inicio, opcoes, aoConectar, aoFalharTodos){
    const n = Rede.BROKERS.length;
    let tentativa = 0;
    const tentar = () => {
      if(tentativa >= n){ aoFalharTodos(); return; }
      const idx = (inicio + tentativa) % n;
      tentativa++;
      let ok = false;
      const c = mqtt.connect(Rede.BROKERS[idx], Object.assign({
        clientId: 'trilha-' + Math.random().toString(36).slice(2, 12),
        clean: true, connectTimeout: 6000, reconnectPeriod: 0, keepalive: 30
      }, opcoes));
      const desiste = () => { if(ok) return; ok = true; try{ c.end(true); }catch(e){} tentar(); };
      const timer = setTimeout(desiste, 7000);
      c.once('connect', () => {
        if(ok) return; ok = true; clearTimeout(timer);
        c.options.reconnectPeriod = 2000;     // daqui em diante, reconecta sozinho
        aoConectar(c, idx);
      });
      c.once('error', () => { clearTimeout(timer); desiste(); });
      c.once('close', () => { if(!ok){ clearTimeout(timer); desiste(); } });
    };
    tentar();
  }

  function hospedarOnline(sala, cb){
    const base = BASE + sala;
    const jog = {};
    let cli = null, ultimo = null;
    const emitir = () => cb.onJogadores && cb.onJogadores(Object.assign({}, jog));
    const enviaEstado = () => { if(cli && ultimo) cli.publish(base + '/estado', JSON.stringify(ultimo), { retain: true, qos: 1 }); };
    const preferido = Number(params.get('b')) || 0;
    conectarMqtt(preferido, {}, (c, idx) => {
      cli = c; Rede.brokerIdx = idx;
      c.subscribe([base + '/jog/+', base + '/msg'], { qos: 1 });
      c.on('message', (topic, payload) => {
        const txt = payload ? payload.toString() : '';
        if(topic === base + '/msg'){
          try{ const m = JSON.parse(txt); if(cb.onMensagem) cb.onMensagem(m); }catch(e){}
          return;
        }
        const pid = topic.slice((base + '/jog/').length);
        if(!txt){ if(jog[pid]){ delete jog[pid]; emitir(); } return; }
        try{
          const info = JSON.parse(txt);
          const antes = jog[pid];
          jog[pid] = Object.assign({}, info, { visto: Date.now() });
          if(!antes || antes.equipe !== info.equipe || antes.nome !== info.nome) emitir();
        }catch(e){}
      });
      c.on('connect', () => { if(cb.onConexao) cb.onConexao(true); c.subscribe([base + '/jog/+', base + '/msg'], { qos: 1 }); enviaEstado(); });
      c.on('offline', () => cb.onConexao && cb.onConexao(false));
      if(cb.onConexao) cb.onConexao(true);
      enviaEstado();
      if(cb.onPronto) cb.onPronto();
    }, () => {
      Rede.erro = 'sem-servidor';
      if(cb.onErro) cb.onErro({ code: 'sem-servidor' });
    });
    const limpa = setInterval(() => {
      let mudou = false;
      for(const pid in jog){ if(Date.now() - jog[pid].visto > 12000){ delete jog[pid]; mudou = true; } }
      if(mudou) emitir();
    }, 3000);
    return {
      publicar(estado){ ultimo = estado; enviaEstado(); },
      encerrar(){
        clearInterval(limpa);
        if(cli){ cli.publish(base + '/estado', JSON.stringify({ fase: 'encerrada' }), { retain: true, qos: 1 }, () => cli.end()); }
      }
    };
  }

  function hospedarLocal(sala, cb){
    const ch = new BroadcastChannel('trilha-' + sala);
    const jog = {};
    let ultimo = null;
    const emitir = () => cb.onJogadores && cb.onJogadores(Object.assign({}, jog));
    ch.onmessage = ev => {
      const d = ev.data || {};
      if(d.k === 'jogador'){ const novo = !jog[d.pid]; jog[d.pid] = Object.assign({}, d.info, { visto: Date.now() }); if(novo || d.mudou) emitir(); if(ultimo) ch.postMessage({ k: 'estado', estado: ultimo }); }
      else if(d.k === 'sair'){ delete jog[d.pid]; emitir(); }
      else if(d.k === 'msg' && cb.onMensagem) cb.onMensagem(d.msg);
    };
    const limpa = setInterval(() => {
      let mudou = false;
      for(const pid in jog){ if(Date.now() - jog[pid].visto > 7000){ delete jog[pid]; mudou = true; } }
      if(mudou) emitir();
    }, 2000);
    if(cb.onConexao) cb.onConexao(true);
    return {
      publicar(estado){ ultimo = estado; ch.postMessage({ k: 'estado', estado }); },
      encerrar(){ clearInterval(limpa); ch.postMessage({ k: 'estado', estado: { fase: 'encerrada' } }); ch.close(); }
    };
  }

  /* ---------------- CELULAR ---------------- */
  Rede.entrar = function(sala, pid, info, cb){
    if(Rede.modo === 'firebase') return entrarFirebase(sala, pid, info, cb);
    if(Rede.modo === 'online') return entrarOnline(sala, pid, info, cb);
    if(Rede.modo === 'local') return entrarLocal(sala, pid, info, cb);
    return null;
  };

  function entrarFirebase(sala, pid, info, cb){
    const ref = db.ref('salas/' + sala);
    const eu = ref.child('jogadores/' + pid);
    let atual = Object.assign({}, info);
    const falha = e => cb.onErro && cb.onErro(e);
    const registrar = () => {
      eu.onDisconnect().remove().catch(falha);
      eu.set(Object.assign({}, atual, { desde: atual.desde || Date.now() })).catch(falha);
    };
    const onCon = s => { if(s.val()){ registrar(); } if(cb.onConexao) cb.onConexao(!!s.val()); };
    db.ref('.info/connected').on('value', onCon);
    const onEstado = s => cb.onEstado && cb.onEstado(s.val());
    ref.child('estado').on('value', onEstado, falha);
    return {
      enviar(msg){ ref.child('msgs').push(Object.assign({}, msg, { pid })).catch(falha); },
      atualizar(novo){ atual = Object.assign({}, atual, novo); eu.update(novo).catch(falha); },
      sair(){ ref.child('estado').off('value', onEstado); db.ref('.info/connected').off('value', onCon); eu.remove(); }
    };
  }

  function entrarOnline(sala, pid, info, cb){
    const base = BASE + sala, meu = base + '/jog/' + pid;
    let atual = Object.assign({ desde: Date.now() }, info);
    let cli = null, hb = null;
    const fila = [];
    const bater = () => { if(cli) cli.publish(meu, JSON.stringify(atual), { qos: 0 }); };
    const preferido = Number(params.get('b')) || 0;
    conectarMqtt(preferido, { will: { topic: meu, payload: '', qos: 0, retain: false } }, c => {
      cli = c;
      c.subscribe(base + '/estado', { qos: 1 });
      c.on('message', (topic, payload) => {
        if(topic !== base + '/estado') return;
        try{ cb.onEstado && cb.onEstado(JSON.parse(payload.toString())); }catch(e){}
      });
      c.on('connect', () => { if(cb.onConexao) cb.onConexao(true); c.subscribe(base + '/estado', { qos: 1 }); bater(); });
      c.on('offline', () => cb.onConexao && cb.onConexao(false));
      if(cb.onConexao) cb.onConexao(true);
      bater();
      hb = setInterval(bater, 3000);
      while(fila.length) c.publish(base + '/msg', fila.shift(), { qos: 1 });
    }, () => {
      if(cb.onConexao) cb.onConexao(false);
      if(cb.onErro) cb.onErro({ code: 'sem-servidor' });
    });
    window.addEventListener('pagehide', () => { if(cli) cli.publish(meu, '', { qos: 0 }); });
    return {
      enviar(msg){
        const txt = JSON.stringify(Object.assign({}, msg, { pid }));
        if(cli) cli.publish(base + '/msg', txt, { qos: 1 }); else fila.push(txt);
      },
      atualizar(novo){ atual = Object.assign({}, atual, novo); bater(); },
      sair(){ clearInterval(hb); if(cli){ cli.publish(meu, '', { qos: 0 }, () => cli.end()); } }
    };
  }

  function entrarLocal(sala, pid, info, cb){
    const ch = new BroadcastChannel('trilha-' + sala);
    let atual = Object.assign({ desde: Date.now() }, info);
    ch.onmessage = ev => { const d = ev.data || {}; if(d.k === 'estado' && cb.onEstado) cb.onEstado(d.estado); };
    const bater = mudou => ch.postMessage({ k: 'jogador', pid, info: atual, mudou: !!mudou });
    bater(true);
    const hb = setInterval(() => bater(false), 2000);
    const bye = () => ch.postMessage({ k: 'sair', pid });
    window.addEventListener('pagehide', bye);
    if(cb.onConexao) cb.onConexao(true);
    return {
      enviar(msg){ ch.postMessage({ k: 'msg', msg: Object.assign({}, msg, { pid }) }); },
      atualizar(novo){ atual = Object.assign({}, atual, novo); bater(true); },
      sair(){ clearInterval(hb); bye(); ch.close(); }
    };
  }

  /* Explica em português por que a conexão não está funcionando */
  Rede.explicar = function(info){
    info = info || {};
    const cod = String(info.erro && (info.erro.code || info.erro.message) || '').toLowerCase();
    if(Rede.modo === 'off') return 'O jogo foi aberto como arquivo no computador. Para usar celulares, abra pelo endereço publicado na internet.';
    if(Rede.modo === 'local') return 'Modo de teste: a sala só funciona entre abas do mesmo navegador deste computador.';
    if(Rede.modo === 'online'){
      if(cod === 'sem-servidor' || info.conectado === false) return 'Não foi possível conectar ao servidor de mensagens. A rede deste aparelho pode estar bloqueando a conexão (algumas redes de universidade fazem isso). Tente pelo 4G ou por outra rede.';
      return 'Conectado ao servidor, mas esta sala não respondeu. Confira o código e se a TV está na tela da sala, no modo "Pelo celular". Se a TV foi recarregada, leia o QR code de novo.';
    }
    if(cod.indexOf('permission') >= 0) return 'O Firebase recusou o acesso: as regras do Realtime Database não foram publicadas. Cole o conteúdo de database.rules.json na aba Regras do Realtime Database e clique em Publicar.';
    if(info.erro) return 'Erro do Firebase: ' + (info.erro.message || info.erro.code || info.erro) + '. Confira o databaseURL em js/firebase-config.js.';
    if(info.conectado === false) return 'Não foi possível falar com o Firebase. Confira a internet e o databaseURL em js/firebase-config.js.';
    return 'Conectado ao servidor, mas esta sala não existe. Confira o código e se a TV criou a sala no modo "Pelo celular".';
  };

  /* QR code em SVG (usa js/vendor/qrcode.js) */
  Rede.qrSvg = function(texto){
    if(typeof qrcode !== 'function') return '';
    const q = qrcode(0, 'M'); q.addData(texto); q.make();
    return q.createSvgTag({ cellSize: 6, margin: 2, scalable: true });
  };

  window.Rede = Rede;
})();
