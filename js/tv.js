/* ==================================================================
   Trilha de Auditoria · tv.js
   Lógica da TV (moderador): tabuleiro, cartas, placar e a sala onde
   os celulares das equipes se conectam. O conteúdo está em conteudo.js.
   Licença MIT.
   ================================================================== */

/* ---------------- Estado e utilitários ---------------- */
const SAVE_KEY = 'trilha-de-auditoria-facc-v4';
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const NIVEL = { facil: 'Fácil', media: 'Média', dificil: 'Difícil', caso: 'Caso prático', real: 'Caso real', cvm: 'Surpresa', dilema: 'Dilema ético' };
const DIFICEIS = ['dificil', 'caso', 'real', 'cvm', 'dilema'];   // acerto dessas ganha o carimbo AUDITADO
const LETRAS = ['A', 'B', 'C', 'D', 'E'];

let state = null;      // tudo que é salvo e pode ser desfeito
let ui = { ptsVis: {}, vooTok: {},
  phase: 'setup', card: null, timer: null, history: [], muted: false, toastT: null,
  pb: false, piada: null, lastDie: null,
  jogadores: {}, capFix: {}, conectado: false, erroRede: null
};
let setupCfg = { n: CONFIG.GRUPOS_PADRAO, names: [], rounds: CONFIG.RODADAS_PADRAO, duracao: CONFIG.DURACAO_PADRAO, tempo: CONFIG.TEMPO_PADRAO, celular: true, matamata: true };
let sala = null;       // conexão com os celulares (Rede.hospedar)

function save(){ try{ localStorage.setItem(SAVE_KEY, JSON.stringify({ state, history: ui.history.slice(-20) })); }catch(e){} }
function loadSave(){ try{ const r = localStorage.getItem(SAVE_KEY); return r ? JSON.parse(r) : null; }catch(e){ return null; } }
function clearSave(){ try{ localStorage.removeItem(SAVE_KEY); }catch(e){} }

function textColor(hex){
  const n = parseInt(hex.slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255;
  return (0.299*r + 0.587*g + 0.114*b) > 150 ? '#14181F' : '#FFFFFF';
}
const team = i => EQUIPES[i];
function chipHtml(i){
  const t = team(i);
  return `<span class="chip" style="background:${t.cor};color:${textColor(t.cor)}">${esc(t.sigla)}</span>`;
}
const curGroup = () => state.groups[state.cur];

/* Piadas sem repetir até esgotar a lista */
const piadaBolsa = { ok: [], no: [] };
/* Registro dos easter eggs que apareceram (para conferir e para o relatório) */
function ovo(nome){ (ui.ovos = ui.ovos || []).push(nome); }
function piada(tipo){
  const pop = tipo === 'ok' ? PIADAS_POP_ACERTO : PIADAS_POP_ERRO;
  if(Math.random() < CONFIG.PIADA_POP_CHANCE){
    const k = 'pop' + tipo;
    if(!piadaBolsa[k] || !piadaBolsa[k].length) piadaBolsa[k] = pop.slice().sort(() => Math.random() - 0.5);
    ovo('piada pop'); return piadaBolsa[k].pop();
  }
  const fonte = tipo === 'ok' ? PIADAS_ACERTO : PIADAS_ERRO;
  if(!piadaBolsa[tipo].length) piadaBolsa[tipo] = fonte.slice().sort(() => Math.random() - 0.5);
  return piadaBolsa[tipo].pop();
}

/* Sons curtos (só tocam depois de um clique, regra dos navegadores) */
let actx = null;
function tone(f, d = 0.12, type = 'sine', v = 0.07, delay = 0){
  if(ui.muted) return;
  try{
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t0 = actx.currentTime + delay, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.value = f;
    g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + d);
    o.connect(g); g.connect(actx.destination); o.start(t0); o.stop(t0 + d + 0.02);
  }catch(e){}
}
const sfx = {
  step: () => tone(520, 0.06, 'triangle', 0.05),
  ok:   () => { tone(660, 0.14, 'triangle', 0.09); tone(880, 0.22, 'triangle', 0.09, 0.12); },
  bad:  () => { tone(196, 0.3, 'sawtooth', 0.06); tone(147, 0.45, 'sawtooth', 0.06, 0.18); },
  tick: () => tone(950, 0.05, 'square', 0.03),
  end:  () => tone(220, 0.5, 'square', 0.05),
  card: () => tone(400, 0.1, 'triangle', 0.06),
  join: () => tone(740, 0.08, 'triangle', 0.05),
  stamp: () => { tone(90, 0.18, 'square', 0.12); tone(60, 0.25, 'sine', 0.15, 0.02); },
  shred: () => { for(let k = 0; k < 14; k++) tone(120 + Math.random()*80, 0.06, 'sawtooth', 0.04, k * 0.07); }
};

function toast(msg){
  const slot = $('#toast-slot');
  slot.innerHTML = `<div class="toast">${esc(msg)}</div>`;
  clearTimeout(ui.toastT);
  ui.toastT = setTimeout(() => { slot.innerHTML = ''; }, 3200);
}

function askConfirm(msg, okLabel, onOk){
  $('#confirm-msg').textContent = msg;
  $('#confirm-ok').textContent = okLabel;
  $('#confirm').hidden = false;
  $('#confirm-ok').onclick = () => { $('#confirm').hidden = true; onOk(); };
  $('#confirm-cancel').onclick = () => { $('#confirm').hidden = true; };
  $('#confirm-ok').focus();
}

/* Placar e desempate: pontos, depois acertos, depois menos erros */
function ranking(){
  const o = state.groups.map((g, i) => ({ g, i })).sort((a, b) => b.g.pts - a.g.pts || b.g.ok - a.g.ok || a.g.err - b.g.err);
  // empate no 1º lugar decidido no mata-mata
  if(state.desempate != null){
    const k = o.findIndex(x => x.i === state.desempate);
    if(k > 0 && sameRank(o[0], o[k])){ const [x] = o.splice(k, 1); o.unshift(x); }
  }
  return o;
}
const sameRank = (a, b) => a.g.pts === b.g.pts && a.g.ok === b.g.ok && a.g.err === b.g.err;

/* ==================================================================
   CELULARES: quem está em cada equipe e quem é o capitão
   ================================================================== */
function membros(t){
  return Object.entries(ui.jogadores)
    .filter(([, j]) => j && j.equipe === t)
    .sort((a, b) => (a[1].desde || 0) - (b[1].desde || 0))
    .map(([pid, j]) => ({ pid, nome: j.nome || 'Sem nome' }));
}
function capitao(t){
  const ms = membros(t);
  if(!ms.length) return null;
  const fix = ui.capFix[t];
  return ms.find(m => m.pid === fix) || ms[0];
}
const ehCapitao = (pid, t) => { const c = capitao(t); return !!c && c.pid === pid; };
const equipeDe = pid => { const j = ui.jogadores[pid]; return j && typeof j.equipe === 'number' ? j.equipe : -1; };
const totalCelulares = () => Object.keys(ui.jogadores).length;
const temCapitao = t => !!capitao(t);

function abrirSala(codigo){
  if(sala) return;
  state.sala = codigo;
  sala = Rede.hospedar(codigo, {
    onJogadores(j){
      const antes = totalCelulares();
      ui.jogadores = j || {};
      if(totalCelulares() > antes) sfx.join();
      renderLobby(); if(!$('#app').hidden){ renderScores(); renderBadge(); if(ui.card) renderCard(); }
      sync();
    },
    onMensagem: recebeMensagem,
    onConexao(ok){ ui.conectado = ok; if(ok) ui.erroRede = null; renderLobby(); },
    onPronto(){ atualizarQr(); },
    onErro(e){ ui.erroRede = e; renderLobby(); toast(Rede.explicar({ erro: e })); }
  });
}

function joinUrl(){
  const q = 'jogador.html?sala=' + state.sala + Rede.extrasConvite();
  try{ return new URL(q, location.href).href; }catch(e){ return q; }
}

/* Mensagens que chegam dos celulares. A TV é quem decide se valem. */
function recebeMensagem(m){
  if(m && m.t === 'mm' && typeof mmResposta === 'function'){ mmResposta(m); return; }
  if(m && m.t === 'avatar'){ recebeAvatar(m); return; }
  if(!m || !state || state.phase !== 'play') return;
  const t = equipeDe(m.pid);
  if(t < 0 || !ehCapitao(m.pid, t)) return;           // só o capitão de cada equipe joga
  const c = ui.card;
  if(m.t === 'dado'){
    if(t === state.cur && (ui.phase === 'idle' || ui.phase === 'skip') && $('#confirm').hidden) primary();
  } else if(m.t === 'resp'){
    if(c && c.kind === 'q' && c.stage === 'answer' && c.who === t && c.q.id === m.carta && c.pending == null){
      const i = Number(m.alt);
      if(i >= 0 && i < c.q.alternativas.length && !c.wrong.includes(i)){
        c.pending = i; c.viaCelular = true; sfx.card(); renderCard();
        setTimeout(() => { if(ui.card === c && c.pending === i){ c.pending = null; chooseAlt(i); } }, 1300);
      }
    }
  } else if(m.t === 'repasse'){
    if(c && c.kind === 'q' && c.stage === 'steal' && podemRoubar(c).includes(t)) roubar(t);
  } else if(m.t === 'vf'){
    if(c && c.kind === 'rel' && c.stage === 'answer' && c.r.id === m.carta && c.vf[t] === undefined){
      c.vf[t] = !!m.val; renderCard();
      const comCel = state.groups.map((g, i) => i).filter(temCapitao);
      if(comCel.length && comCel.every(i => c.vf[i] !== undefined) && comCel.length === state.groups.length) revelarRelampago();
    }
  }
}

/* ---------------- Imagem do pino (escolhida pelo capitão) ---------------- */
function avatarValido(m){
  if(m.tipo === 'emoji') return typeof m.v === 'string' && m.v.length > 0 && m.v.length <= 16 && !/[<>&"']/.test(m.v);
  if(m.tipo === 'img') return typeof m.v === 'string' && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(m.v) && m.v.length <= 60000;
  return false;
}
function recebeAvatar(m){
  if(!state || !(state.phase === 'lobby' || state.phase === 'play')) return;
  const t = equipeDe(m.pid);
  if(t < 0 || !ehCapitao(m.pid, t)) return;
  if(m.tipo == null) state.groups[t].avatar = null;
  else if(avatarValido(m)) state.groups[t].avatar = { tipo: m.tipo, v: m.v };
  else return;
  atualizaPino(t); renderLobby(); save(); sync();
}
function removerAvatar(t){ state.groups[t].avatar = null; atualizaPino(t); renderLobby(); save(); sync(); }
/* Miniatura redonda da imagem (lobby da TV) */
function avatarMini(t){
  const a = state.groups[t].avatar; if(!a) return '';
  const inner = a.tipo === 'img' ? `<img src="${a.v}" alt="">` : `<span>${esc(a.v)}</span>`;
  return `<span class="av-mini" style="--team:${team(t).cor}">${inner}</span>`;
}

/* ---------------- Estado público (o que os celulares veem) ---------------- */
let seq = 0, syncT = null;
function sync(){
  document.body.classList.toggle('pb', !!ui.pb);
  if(!sala || !state) return;
  clearTimeout(syncT);
  syncT = setTimeout(() => sala.publicar(estadoPublico()), 40);
}
function estadoPublico(){
  const fase = state.phase === 'lobby' ? 'lobby' : state.phase === 'end' ? (state.mm && state.mm.ativo ? 'matamata' : (ui.revelaAte > Date.now() ? 'apurando' : 'fim')) : 'jogo';
  const est = {
    v: ++seq, versao: Rede.VERSAO, sala: state.sala, fase,
    rodada: state.round, rodadas: state.rounds, vez: state.cur, turno: ui.phase, dado: ui.lastDie,
    equipes: state.groups.map((g, i) => {
      const cap = capitao(i);
      return { nome: g.name, sigla: team(i).sigla, cor: team(i).cor, pts: g.pts, pos: g.pos, ok: g.ok, err: g.err,
        avatar: g.avatar ? (g.avatar.tipo === 'emoji' ? g.avatar : { tipo: 'img', n: g.avatar.v.length }) : null,
        voltas: g.voltas, skip: g.skip, roubos: roubosRestantes(i), semRessalvas: semRessalvas(g), capitao: cap ? cap.pid : null, capNome: cap ? cap.nome : null, membros: membros(i).length };
    }),
    carta: cartaPublica(ui.card), pb: !!ui.pb, piada: ui.piada,
    timer: ui.timer ? { left: ui.timer.left, total: ui.timer.total, running: ui.timer.running } : null,
    relogio: state.relogio ? { restante: Math.round(state.relogio.restante), acabou: !!state.relogio.acabou } : null
  };
  if(state.mm && typeof mmPublico === 'function') est.mm = mmPublico();
  if(fase === 'fim' || fase === 'matamata'){
    const order = ranking();
    est.ranking = order.map(o => o.i);
    est.empate = order.length > 1 && sameRank(order[0], order[1]);
  }
  return JSON.parse(JSON.stringify(est));
}
function cartaPublica(c){
  if(!c) return null;
  const t = TIPOS[c.tipo];
  const base = { kind: c.kind, tipo: c.tipo, nome: t ? t.nome : '', stage: c.stage, who: c.who, done: !!c.done };
  if(c.kind === 'q'){
    const q = c.q, rev = c.stage === 'reveal';
    return Object.assign(base, {
      id: q.id, titulo: c.tipo === 'real' ? `${q.caso} · ${q.ano}` : t.nome, nivel: NIVEL[q.nivel], pontos: qPoints(c),
      contexto: q.contexto || null, pergunta: q.pergunta, alternativas: q.alternativas,
      steal: c.steal, tried: c.tried, wrong: c.wrong, pending: c.pending == null ? null : c.pending,
      correta: rev ? q.correta : null, explicacao: rev ? q.explicacao : null, result: rev ? c.result : null,
      awarded: rev ? (c.awarded || 0) : null, winner: rev && c.result === 'ok' ? c.winner : null,
      parcial: rev && q.parcial ? q.parcial : null,
      piadaCaso: rev && q.piada ? q.piada : null, rouboVale: Math.round(CONFIG.PONTOS[q.nivel] * CONFIG.ROUBO_FRACAO), podemRoubar: c.stage === 'steal' ? podemRoubar(c) : []
    });
  }
  if(c.kind === 'dil'){
    return Object.assign(base, { id: c.d.id, situacao: c.d.situacao, pergunta: c.d.pergunta,
      pontos: c.stage === 'debate' ? null : c.d.pontosChave, awarded: c.stage === 'done' ? (c.awarded || 0) : null });
  }
  if(c.kind === 'rel'){
    return Object.assign(base, { id: c.r.id, afirmacao: c.r.afirmacao, responderam: Object.keys(c.vf).map(Number),
      resposta: c.stage === 'answer' ? null : c.r.resposta, explicacao: c.stage === 'answer' ? null : c.r.explicacao,
      hits: c.stage === 'done' ? c.hits : null });
  }
  if(c.kind === 'ev') return Object.assign(base, { titulo: c.e.titulo, texto: c.e.texto, efeito: efeitoTxt(c.e.efeito) });
  return Object.assign(base, { titulo: c.e.titulo, texto: c.e.texto, efeito: 'Fica sem jogar na próxima rodada' });
}

/* ==================================================================
   TELA INICIAL
   ================================================================== */
function rulesHtml(){
  const tipos = Object.entries(TIPOS).map(([k, t]) =>
    `<div><i style="background:${t.fill};border-color:${t.stripe}"></i><span><b>${t.nome}.</b> ${t.desc}</span></div>`).join('');
  return `<h3>Como funciona</h3>
  <ol>
    <li>Cada equipe é uma firma de auditoria e entra na sala pelo QR code. O primeiro celular da equipe é o <b>capitão</b>; os outros acompanham.</li>
    <li>Na vez da equipe, o capitão lança o dado pelo celular (ou o professor, com <b>Espaço</b>). O pino anda casa por casa: laço esquerdo (1 a 18), laço direito (19 a 36), e volta ao centro.</li>
    <li>A equipe discute e o capitão responde no celular. Se a equipe estiver sem celular, o professor marca a alternativa dita em voz alta (teclas <b>1 a 4</b>).</li>
    <li>Errou? A tela fica em preto e branco e as outras equipes podem fazer um <b>Roubo de Evidência</b>: respondem valendo metade dos pontos. Cada equipe só pode roubar <b>uma vez</b> por partida.</li>
    <li>A cor de cada casa mostra o tipo de carta (veja a legenda ao lado do tabuleiro).</li>
    <li>Cada volta completa no tabuleiro vale <b>+${CONFIG.PONTOS.volta}</b>, o "parecer emitido".</li>
    <li>Quando o relógio da partida zera (ou acabam as rodadas, no modo sem limite), a rodada em andamento vai até o fim e vence quem tiver mais pontos. Desempate: mais acertos, depois menos erros.</li>
    <li>O professor pode marcar qualquer carta para discussão (tecla <b>M</b>). No fim, o jogo lista essas cartas e as que ninguém acertou.</li>
  </ol>
  <div class="types">${tipos}</div>`;
}

function modoInfo(){
  if(Rede.modo === 'firebase') return { ok: true, txt: 'Servidor Firebase configurado. Os celulares entram pelo QR code.' };
  if(Rede.modo === 'online') return { ok: true, txt: 'Os celulares entram pelo QR code, de qualquer rede (Wi-Fi ou 4G). A conexão usa um servidor público e gratuito, sem cadastro.' };
  if(Rede.modo === 'local') return { ok: true, txt: 'Modo de teste: sem Firebase configurado, os "celulares" só funcionam como outras abas deste navegador. Para a sala de aula, siga o README.' };
  return { ok: false, txt: window.TRILHA_SEM_CELULAR
    ? 'Esta versão roda só na TV. Para usar celulares, publique a pasta do jogo com o Firebase (veja o README).'
    : 'Para usar celulares, configure o Firebase em js/firebase-config.js e abra o jogo pelo endereço publicado (veja o README).' };
}

function buildSetup(){
  $('#firm-strip').innerHTML = EQUIPES.slice(0, 4).map(t => `<i style="background:${t.cor}"></i>`).join('');
  const info = modoInfo();
  if(!info.ok) setupCfg.celular = false;
  $('#seg-modo').innerHTML = `
    <button data-m="1" class="${setupCfg.celular ? 'sel' : ''}" ${info.ok ? '' : 'disabled'}>Pelo celular<small>QR code, capitão responde</small></button>
    <button data-m="0" class="${!setupCfg.celular ? 'sel' : ''}">Só na TV<small>professor marca as respostas</small></button>`;
  $('#seg-modo').onclick = e => { const b = e.target.closest('button'); if(!b || b.disabled) return; readNames(); setupCfg.celular = b.dataset.m === '1'; buildSetup(); };
  $('#modo-help').textContent = info.txt;
  $('#btn-start').textContent = setupCfg.celular ? 'Criar sala' : 'Começar partida';

  const segN = $('#seg-n');
  segN.innerHTML = CONFIG.GRUPOS_OPCOES.map(n => `<button data-n="${n}" class="${n===setupCfg.n?'sel':''}">${n}</button>`).join('');
  segN.onclick = e => { const b = e.target.closest('button'); if(!b) return; readNames(); setupCfg.n = +b.dataset.n; buildSetup(); };

  let html = '';
  for(let i = 0; i < setupCfg.n; i++){
    const v = setupCfg.names[i] || team(i).firma;
    html += `<div class="name-row">${chipHtml(i)}<input id="gname-${i}" maxlength="24" value="${esc(v)}" aria-label="Nome da equipe ${i+1}"></div>`;
  }
  $('#names').innerHTML = html;

  const segR = $('#seg-rounds');
  segR.innerHTML = CONFIG.DURACAO_OPCOES.map(o => `<button data-d="${o.min}" class="${o.min===setupCfg.duracao?'sel':''}">${o.min ? o.min + ' min' : 'Sem limite'}<small>${o.txt}</small></button>`).join('');
  segR.onclick = e => { const b = e.target.closest('button'); if(!b) return; readNames(); setupCfg.duracao = +b.dataset.d; buildSetup(); };
  const segRod = $('#seg-rodadas');
  segRod.hidden = setupCfg.duracao !== 0;
  segRod.innerHTML = CONFIG.RODADAS_OPCOES.map(n => `<button data-r="${n}" class="${n===setupCfg.rounds?'sel':''}">${n} rodadas</button>`).join('');
  segRod.onclick = e => { const b = e.target.closest('button'); if(!b) return; readNames(); setupCfg.rounds = +b.dataset.r; buildSetup(); };
  $('#duracao-help').textContent = setupCfg.duracao
    ? `Quando o relógio zerar, a rodada em andamento vai até o fim e a partida termina.`
    : 'Sem relógio: a partida termina depois do número de rodadas escolhido (1 rodada = cada equipe joga uma vez).';

  const segT = $('#seg-tempo');
  segT.innerHTML = CONFIG.TEMPO_OPCOES.map(t => `<button data-t="${t}" class="${t===setupCfg.tempo?'sel':''}">${t} s</button>`).join('');
  segT.onclick = e => { const b = e.target.closest('button'); if(!b) return; readNames(); setupCfg.tempo = +b.dataset.t; buildSetup(); };

  $('#field-mm').hidden = !setupCfg.celular;
  $('#seg-mm').innerHTML = `
    <button data-mm="1" class="${setupCfg.matamata ? 'sel' : ''}">Com mata-mata<small>Auditor-Sócio no fim</small></button>
    <button data-mm="0" class="${!setupCfg.matamata ? 'sel' : ''}">Sem mata-mata<small>termina no pódio</small></button>`;
  $('#seg-mm').onclick = e => { const b = e.target.closest('button'); if(!b) return; readNames(); setupCfg.matamata = b.dataset.mm === '1'; buildSetup(); };

  const ine = ineditas();
  $('#hist-help').textContent = `${ine.livres} de ${ine.total} perguntas ainda não saíram neste computador. Cada partida usa primeiro as inéditas.`;
  $('#btn-hist').hidden = ine.livres === ine.total;
  $('#btn-hist').onclick = () => askConfirm('Zerar o histórico? As perguntas que já saíram voltam a valer como inéditas.', 'Zerar histórico', () => { guardaHistorico({}); buildSetup(); });

  $('#rules-box').innerHTML = rulesHtml();
  const saved = loadSave();
  $('#btn-resume').hidden = !(saved && saved.state && (saved.state.phase === 'play' || saved.state.phase === 'lobby'));
}
function readNames(){
  for(let i = 0; i < setupCfg.n; i++){
    const inp = $('#gname-' + i);
    if(inp) setupCfg.names[i] = inp.value.trim() || team(i).firma;
  }
}

function newGame(){
  readNames();
  state = {
    phase: setupCfg.celular ? 'lobby' : 'play', sala: null,
    groups: Array.from({length: setupCfg.n}, (_, i) => ({ name: setupCfg.names[i] || team(i).firma, pts: 0, pos: 0, voltas: 0, skip: false, ok: 0, err: 0, roubos: 0, rouboPts: 0, perdas: 0 })),
    cur: 0, round: 1, rounds: setupCfg.duracao ? CONFIG.RODADAS_MAXIMO : setupCfg.rounds, tempo: setupCfg.tempo, matamata: setupCfg.celular && setupCfg.matamata,
    relogio: setupCfg.duracao ? { total: setupCfg.duracao * 60, restante: setupCfg.duracao * 60, acabou: false } : null,
    used: { aud: [], aud2: [], eti: [], caso: [], real: [], dil: [], rel: [] },
    log: []
  };
  ui.history = []; ui.capFix = {}; ui.jogadores = {};
  if(setupCfg.celular){ abrirSala(Rede.novoCodigo()); save(); showLobby(); }
  else { enterGame(); beginTurn(); }
}
function resumeGame(){
  const saved = loadSave();
  if(!saved) return;
  state = saved.state;
  state.log = state.log || [];
  ui.history = saved.history || [];
  if(state.sala && Rede.modo !== 'off') abrirSala(state.sala);
  if(state.phase === 'lobby'){ showLobby(); return; }
  enterGame();
  const g = curGroup();
  if(g.skip){ g.skip = false; ui.phase = 'skip'; } else ui.phase = 'idle';
  renderAll();
}
function enterGame(){
  $('#setup').hidden = true; $('#end').hidden = true; $('#lobby').hidden = true; $('#app').hidden = false;
  renderBoard(); renderAll();
}

/* ---------------- Sala (QR code) ---------------- */
function atualizarQr(){
  if(!state || !state.sala) return;
  const url = joinUrl();
  $('#qr-big').innerHTML = Rede.qrSvg(url);
  $('#join-url').textContent = url;
  $('#qr-mini').dataset.code = '';
  if(!$('#app').hidden) renderBadge();
}
function showLobby(){
  $('#setup').hidden = true; $('#lobby').hidden = false;
  const url = joinUrl();
  $('#qr-big').innerHTML = Rede.qrSvg(url);
  $('#code-big').textContent = state.sala;
  $('#join-url').textContent = url;
  $('#btn-lobby-go').textContent = state.phase === 'lobby' ? 'Começar partida' : 'Voltar ao jogo';
  $('#btn-lobby-back').hidden = state.phase !== 'lobby';
  renderLobby(); sync();
}
function renderLobby(){
  if(!state || !state.sala || $('#lobby').hidden) return;
  const warn = [], ok = [];
  if(location.protocol === 'file:') warn.push('Você abriu o jogo como arquivo. Os celulares não conseguem abrir este endereço: publique a pasta (veja o README).');
  if(Rede.modo === 'local') warn.push(Rede.explicar());
  if(ui.erroRede) warn.push(Rede.explicar({ erro: ui.erroRede }));
  else if(!ui.conectado && Rede.modo !== 'online') warn.push(Rede.explicar({ conectado: false }));
  if((Rede.modo === 'firebase' || Rede.modo === 'online') && ui.conectado && !ui.erroRede) ok.push('Conectado ao servidor. Os celulares já podem entrar.');
  if(Rede.modo === 'online' && !ui.conectado && !ui.erroRede) ok.push('Conectando ao servidor…');
  $('#lobby-warn').innerHTML = warn.map(w => `<div class="warn-box">${esc(w)}</div>`).join('') + ok.map(w => `<div class="info-box">${esc(w)}</div>`).join('');
  $('#teams-grid').innerHTML = state.groups.map((g, i) => {
    const ms = membros(i), cap = capitao(i);
    const lista = ms.length ? ms.map(m => `<button class="member ${cap && cap.pid === m.pid ? 'cap' : ''}" data-cap="${i}" data-pid="${esc(m.pid)}"><span>${esc(m.nome)}</span><span class="role">${cap && cap.pid === m.pid ? 'capitão' : 'torcida'}</span></button>`).join('')
      : '<span class="empty">Ninguém ainda. O professor responde por esta equipe.</span>';
    const av = g.avatar ? `<div class="av-row">${avatarMini(i)}<span>Imagem do pino</span><button class="av-rm" data-rmav="${i}">remover</button></div>` : '';
    return `<div class="team-col" style="--team:${team(i).cor}"><h3>${chipHtml(i)} ${esc(g.name)}</h3>${av}${lista}</div>`;
  }).join('');
  const espect = Object.values(ui.jogadores).filter(j => j && (j.equipe === -1 || j.equipe == null)).length;
  $('#spectators').textContent = `${totalCelulares()} celular${totalCelulares() === 1 ? '' : 'es'} na sala${espect ? ` · ${espect} só assistindo` : ''}.`;
}
$('#teams-grid').addEventListener('click', e => {
  const rm = e.target.closest('[data-rmav]'); if(rm){ removerAvatar(+rm.dataset.rmav); return; }
  const b = e.target.closest('[data-cap]'); if(!b) return;
  ui.capFix[+b.dataset.cap] = b.dataset.pid; renderLobby(); sync();
});
$('#btn-lobby-go').onclick = () => {
  if(state.phase === 'lobby'){ state.phase = 'play'; enterGame(); beginTurn(); }
  else { $('#lobby').hidden = true; renderAll(); }
};
$('#btn-lobby-back').onclick = () => { $('#lobby').hidden = true; $('#setup').hidden = false; buildSetup(); };

function renderBadge(){
  const b = $('#room-badge');
  if(!state.sala){ b.hidden = true; return; }
  b.hidden = false;
  if(!$('#qr-mini').dataset.code || $('#qr-mini').dataset.code !== state.sala){
    $('#qr-mini').innerHTML = Rede.qrSvg(joinUrl()); $('#qr-mini').dataset.code = state.sala;
  }
  $('#code-mini').textContent = state.sala;
  $('#phones-mini').textContent = totalCelulares();
}

/* ==================================================================
   TABULEIRO EM 8 (lemniscata) sobre papel quadriculado
   ================================================================== */
const BOARD = { A: 440, YS: 1.5, TRACK_W: 80, GAP: 62, BASE_W: 1000, BASE_H: 580, STRIPE: 9 };
let geom = null;

function isVertical(){ return window.innerWidth < 700 && window.innerHeight > window.innerWidth; }

function buildGeometry(vertical){
  const A = BOARD.A, YS = BOARD.YS, N = 4000, pts = [], len = [0];
  for(let i = 0; i <= N; i++){
    const t = Math.PI/2 + i * (2*Math.PI/N), s = Math.sin(t), c = Math.cos(t), d = 1 + s*s;
    pts.push({ x: A*c/d, y: YS*A*s*c/d });
    if(i > 0) len.push(len[i-1] + Math.hypot(pts[i].x - pts[i-1].x, pts[i].y - pts[i-1].y));
  }
  const L = len[N];
  const at = sv => {
    let lo = 0, hi = N;
    while(hi - lo > 1){ const m = (lo + hi) >> 1; if(len[m] < sv) lo = m; else hi = m; }
    const f = (sv - len[lo]) / ((len[hi] - len[lo]) || 1);
    const dx = pts[hi].x - pts[lo].x, dy = pts[hi].y - pts[lo].y, dl = Math.hypot(dx, dy) || 1;
    return { x: pts[lo].x + dx*f, y: pts[lo].y + dy*f, tx: dx/dl, ty: dy/dl };
  };
  const W = vertical ? BOARD.BASE_H : BOARD.BASE_W, H = vertical ? BOARD.BASE_W : BOARD.BASE_H;
  const map = vertical ? (x, y) => ({ x: W/2 + y, y: H/2 + x }) : (x, y) => ({ x: W/2 + x, y: H/2 + y });
  const total = TRILHA.length, n1 = Math.round(total/2), n2 = total - n1, G = BOARD.GAP, w2 = BOARD.TRACK_W/2, S = BOARD.STRIPE;
  const fmt = arr => arr.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' ');
  const cells = [];
  [[G, L/2 - G, n1, -0.6*A], [L/2 + G, L - G, n2, 0.6*A]].forEach(([a, b, n, lobeX]) => {
    const step = (b - a) / n;
    for(let k = 0; k < n; k++){
      const sa = a + k*step + 2.2, sb = a + (k+1)*step - 2.2;
      const mid = at((sa + sb)/2), mnx = -mid.ty, mny = mid.tx;
      const dPlus = Math.hypot(mid.x + mnx*w2 - lobeX, mid.y + mny*w2), dMinus = Math.hypot(mid.x - mnx*w2 - lobeX, mid.y - mny*w2);
      const out = dPlus > dMinus ? 1 : -1;
      const outer = [], inner = [], band = [];
      for(let j = 0; j <= 8; j++){
        const q = at(sa + (sb - sa) * j/8), nx = -q.ty * out, ny = q.tx * out;
        outer.push(map(q.x + nx*w2, q.y + ny*w2));
        inner.push(map(q.x - nx*w2, q.y - ny*w2));
        band.push(map(q.x + nx*(w2 - S), q.y + ny*(w2 - S)));
      }
      const c = at((sa + sb)/2);
      cells.push({
        num: cells.length + 1,
        poly: fmt(outer.concat(inner.slice().reverse())),
        stripe: fmt(outer.concat(band.slice().reverse())),
        center: map(c.x - (-c.ty*out)*S/2, c.y - (c.tx*out)*S/2)
      });
    }
  });
  const road = pts.filter((_, i) => i % 10 === 0).map(p => { const m = map(p.x, p.y); return m.x.toFixed(1) + ',' + m.y.toFixed(1); }).join(' ');
  const arrows = [G - 6, L/2 + G - 6].map(sv => {
    const q = at(sv), m = map(q.x, q.y), v = vertical ? { x: q.ty, y: q.tx } : { x: q.tx, y: q.ty };
    return { x: m.x, y: m.y, rot: Math.atan2(v.y, v.x) * 180 / Math.PI };
  });
  return { vertical, W, H, cells, road, arrows, plaza: map(0, 0), lobe1: map(-0.6*A, 0), lobe2: map(0.6*A, 0) };
}

const SANS = 'Atkinson Hyperlegible, Segoe UI, Arial, sans-serif';
const SERIF = 'Bitter, Rockwell, Georgia, serif';
const INK = '#1B2230';

function renderBoard(){
  const svg = $('#board'), g = buildGeometry(isVertical());
  geom = g;
  svg.setAttribute('viewBox', `0 0 ${g.W} ${g.H}`);
  let s = `<defs>
    <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="#E0DACB" stroke-width="1"/></pattern>
    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="8" height="8" fill="#DCD7CC"/><line x1="0" y1="0" x2="0" y2="8" stroke="#C4BEB2" stroke-width="3"/></pattern>
  </defs>
  <rect x="4" y="4" width="${g.W-8}" height="${g.H-8}" rx="22" fill="#F3F0E7"/>
  <rect x="4" y="4" width="${g.W-8}" height="${g.H-8}" rx="22" fill="url(#grid)"/>
  <rect x="4" y="4" width="${g.W-8}" height="${g.H-8}" rx="22" fill="none" stroke="${INK}" stroke-width="5"/>
  <text x="${g.lobe1.x}" y="${g.lobe1.y-8}" text-anchor="middle" font-family="${SERIF}" font-size="34" font-weight="800" fill="${INK}">Trilha de</text>
  <text x="${g.lobe1.x}" y="${g.lobe1.y+30}" text-anchor="middle" font-family="${SERIF}" font-size="34" font-weight="800" fill="${INK}">Auditoria</text>
  <text x="${g.lobe1.x}" y="${g.lobe1.y+58}" text-anchor="middle" font-family="${SANS}" font-size="13" font-weight="700" fill="#5C6170" letter-spacing="2">AUDITORIA I · II · ÉTICA</text>
  <text x="${g.lobe2.x}" y="${g.lobe2.y+6}" text-anchor="middle" font-family="${SERIF}" font-size="56" font-weight="800" fill="${INK}">FACC</text>
  <text x="${g.lobe2.x}" y="${g.lobe2.y+40}" text-anchor="middle" font-family="${SANS}" font-size="22" font-weight="700" fill="#5C6170" letter-spacing="8">UFRJ</text>
  <polyline points="${g.road}" fill="none" stroke="${INK}" stroke-width="${BOARD.TRACK_W+12}" stroke-linejoin="round"/>`;
  g.cells.forEach(c => {
    // Cor = tipo da casa (legenda ao lado); dentro, só o número
    const k = TRILHA[c.num-1], t = TIPOS[k] || TIPOS.aud;
    const fill = k === 'pausa' ? 'url(#hatch)' : t.fill;
    s += `<polygon points="${c.poly}" fill="${fill}" stroke="${INK}" stroke-width="2"/>
      <polygon points="${c.stripe}" fill="${t.stripe}"/>
      <text x="${c.center.x}" y="${c.center.y+11}" text-anchor="middle" font-family="${SANS}" font-size="31" font-weight="700" fill="${k === 'real' ? '#FFFFFF' : INK}">${c.num}</text>`;
  });
  s += `<polygon id="cell-hl-base" points="" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>
  <polygon id="cell-hl" points="" fill="none" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
`;
  // setas antes da praça: o círculo cobre a base delas e o texto INÍCIO fica livre
  g.arrows.forEach(a => {
    s += `<polygon points="-11,-10 13,0 -11,10" fill="${INK}" stroke="#F3F0E7" stroke-width="2" transform="translate(${a.x.toFixed(1)},${a.y.toFixed(1)}) rotate(${a.rot.toFixed(1)})"/>`;
  });
  s += `<circle cx="${g.plaza.x}" cy="${g.plaza.y}" r="58" fill="#F3F0E7" stroke="${INK}" stroke-width="5"/>
  <text x="${g.plaza.x}" y="${g.plaza.y-37}" text-anchor="middle" font-family="${SANS}" font-size="12" font-weight="800" fill="${INK}" letter-spacing="1.5">INÍCIO</text>`;
  s += `<g id="pawns"></g>`;
  svg.innerHTML = s;

  const layer = $('#pawns'), NS = 'http://www.w3.org/2000/svg';
  state.groups.forEach((grp, i) => {
    const t = team(i), c = t.cor, el = document.createElementNS(NS, 'g');
    const fs = t.sigla.length >= 4 ? 7 : t.sigla.length === 3 ? 8.5 : 11;
    el.setAttribute('class', 'pawn'); el.setAttribute('id', 'pawn-' + i);
    el.innerHTML = pinoSvg(i);
    layer.appendChild(el);
  });
  renderPawns();
}

/* Pino: corpo na cor da equipe; a cabeça mostra a sigla ou a imagem escolhida pelo capitão */
function pinoSvg(i){
  const t = team(i), c = t.cor, a = state.groups[i].avatar;
  const fs = t.sigla.length >= 4 ? 7 : t.sigla.length === 3 ? 8.5 : 11;
  const corpo = `<ellipse cx="0" cy="17" rx="15" ry="5" fill="rgba(0,0,0,.3)"/>
      <path d="M-13 17 Q-13 4 -6 -3 L6 -3 Q13 4 13 17 Z" fill="${c}" stroke="#14181F" stroke-width="2.2"/>`;
  if(!a) return `<g class="pawn-body">${corpo}
      <circle cx="0" cy="-11" r="12" fill="${c}" stroke="#14181F" stroke-width="2.2"/>
      <text x="0" y="${-11 + fs*0.36}" text-anchor="middle" font-family="${SANS}" font-size="${fs}" font-weight="700" fill="${textColor(c)}">${esc(t.sigla)}</text>${coroaSvg(-25)}</g>`;
  const R = 15, cy = -14;
  const miolo = a.tipo === 'img'
    ? `<clipPath id="pclip-${i}"><circle cx="0" cy="${cy}" r="${R - 2}"/></clipPath><image href="${a.v}" x="${-R + 2}" y="${cy - R + 2}" width="${2*R - 4}" height="${2*R - 4}" preserveAspectRatio="xMidYMid slice" clip-path="url(#pclip-${i})"/>`
    : `<text x="0" y="${cy + 6.5}" text-anchor="middle" font-size="18">${esc(a.v)}</text>`;
  return `<g class="pawn-body">${corpo}
      <circle cx="0" cy="${cy}" r="${R + 1.6}" fill="#14181F"/>
      <circle cx="0" cy="${cy}" r="${R}" fill="#F4F1EA" stroke="${c}" stroke-width="3.2"/>${miolo}${coroaSvg(-32)}</g>`;
}
function coroaSvg(y){
  return `<text class="coroa" x="0" y="${y}" text-anchor="middle" font-size="18">👑</text>`;
}
function atualizaPino(i){ const el = document.getElementById('pawn-' + i); if(el) el.innerHTML = pinoSvg(i); }

const OFFSETS_PRACA = [[-18,-2],[18,-2],[-18,16],[18,16],[0,6],[0,22]];
const OFFSETS = [[-17,-8],[17,-8],[-17,14],[17,14],[0,-26],[0,30]];
function renderPawns(){
  if(!geom) return;
  const occ = {};
  state.groups.forEach((g, i) => { (occ[g.pos] = occ[g.pos] || []).push(i); });
  state.groups.forEach((g, i) => {
    const el = document.getElementById('pawn-' + i); if(!el) return;
    const base = g.pos > 0 ? geom.cells[g.pos-1].center : geom.plaza;
    const offs = g.pos > 0 ? OFFSETS : OFFSETS_PRACA;
    const list = occ[g.pos], off = list.length > 1 ? offs[list.indexOf(i) % offs.length] : [0, 0];
    const lift = g.pos > 0 ? -32 : 16;   // na praça, os pinos ficam abaixo do texto INÍCIO
    const y = Math.max(62, base.y + off[1] + lift);   // casas da borda de cima: a cabeça do pino não sai do tabuleiro
    el.style.transform = `translate(${base.x + off[0]}px, ${y}px)`;
    el.classList.toggle('active', i === state.cur);
  });
  const active = document.getElementById('pawn-' + state.cur);
  if(active) active.parentNode.appendChild(active);
  atualizaCoroa();
  const g = curGroup(), pts = g && g.pos > 0 ? geom.cells[g.pos-1].poly : '';
  const hl = $('#cell-hl'), base = $('#cell-hl-base');
  if(hl){ hl.setAttribute('points', pts); hl.setAttribute('stroke', team(state.cur).cor); }
  if(base) base.setAttribute('points', pts);
  sync();
}

/* ==================================================================
   PAINÉIS
   ================================================================== */
function renderAll(){ renderHeader(); renderTurn(); renderScores(); renderLegend(); renderPawns(); renderRibbon(); renderBadge(); sync(); }

function fmtTempo(s){ s = Math.max(0, Math.round(s)); return Math.floor(s/60) + ':' + String(s % 60).padStart(2, '0'); }
function renderHeader(){
  const rl = state.relogio;
  if(rl){
    const fim = rl.acabou ? '<span class="last-round">RODADA FINAL</span>' : '';
    $('#round-box').innerHTML = `${fim}<span>Rodada <strong class="num">${state.round}</strong></span><span class="clock ${rl.restante <= 300 ? 'warn' : ''} ${ui.relogioPausado ? 'paused' : ''}" title="Tempo de jogo restante">${rl.acabou ? '0:00' : fmtTempo(rl.restante)}</span>`;
    return;
  }
  let dots = '';
  for(let r = 1; r <= state.rounds; r++) dots += `<i class="${r < state.round ? 'on' : r === state.round ? 'now' : ''}"></i>`;
  const last = state.round === state.rounds ? '<span class="last-round">ÚLTIMA RODADA</span>' : '';
  $('#round-box').innerHTML = `${last}<span>Rodada <strong class="num">${state.round}</strong> de ${state.rounds}</span><div class="dots">${dots}</div>`;
}

function renderTurn(){
  const g = curGroup(), t = team(state.cur);
  const where = g.pos > 0 ? `Casa ${g.pos} · ${TIPOS[TRILHA[g.pos-1]].nome}` : 'Na praça central';
  $('#turn-who').innerHTML = `<div class="label">Vez de</div><div class="name">${esc(g.name)}</div><div class="where">${where}</div>`;
  const btn = $('#btn-roll');
  btn.style.setProperty('--team', t.cor); btn.style.setProperty('--team-ink', textColor(t.cor));
  const labels = { idle: 'Lançar o dado <kbd>Espaço</kbd>', skip: 'Passar a vez <kbd>Espaço</kbd>', rolling: 'Rolando…', moving: 'Andando…', card: 'Carta em jogo' };
  btn.innerHTML = labels[ui.phase] || 'Lançar o dado';
  btn.disabled = !(ui.phase === 'idle' || ui.phase === 'skip');
  const cap = capitao(state.cur);
  $('#turn-note').textContent = state.sala && ui.phase === 'idle' ? (cap ? `ou ${cap.nome} lança pelo celular` : 'equipe sem celular: lance pela TV') : '';
}

function renderScores(){
  $('#score-list').innerHTML = ranking().map((o, rank) => {
    const cap = capitao(o.i), n = membros(o.i).length;
    const cel = state.sala ? (n ? ` · ${n} cel. · cap. ${cap ? cap.nome : ''}` : ' · sem celular') : '';
    return `<div class="score-row ${o.i === state.cur ? 'now' : ''}" data-gi="${o.i}" style="--team:${team(o.i).cor}">
      <span class="rk num">${rank+1}º</span>${chipHtml(o.i)}
      <div class="nm"><b>${esc(o.g.name)}${semRessalvas(o.g) ? ' <span class="badge-sr">Sem ressalvas</span>' : ''}${o.g.continuidade && o.g.pts === 0 ? ' <span class="badge-sr badge-gc">Continuidade em dúvida</span>' : ''}</b><span>${o.g.pos > 0 ? 'casa ' + o.g.pos : 'início'} · ${o.g.ok} acertos${o.g.skip ? ' · perde a vez' : ''}${roubosRestantes(o.i) > 0 ? '' : ' · roubo usado'}${esc(cel)}</span></div>
      <div><div class="pts num">${ui.ptsVis[o.i] != null ? ui.ptsVis[o.i] : o.g.pts}</div><div class="adj"><button data-adj="${o.i}" data-d="-5" aria-label="Tirar 5 pontos">−5</button><button data-adj="${o.i}" data-d="5" aria-label="Dar 5 pontos">+5</button></div></div>
    </div>`;
  }).join('');
  atualizaCoroa();
  sync();
}

/* Coroa no pino de quem lidera sozinho (some no empate e com zero pontos) */
function atualizaCoroa(){
  if(!state || !state.groups) return;
  const o = ranking(), lider = o.length && o[0].g.pts > 0 && !(o[1] && sameRank(o[0], o[1])) ? o[0].i : -1;
  state.groups.forEach((g, i) => {
    const el = document.getElementById('pawn-' + i); if(!el) return;
    const era = el.classList.contains('lider');
    el.classList.toggle('lider', i === lider);
    if(i === lider && !era){ const c = el.querySelector('.coroa'); if(c){ c.classList.remove('nova'); void c.getBBox(); c.classList.add('nova'); } }
  });
}

function renderLegend(){
  $('#legend').innerHTML = Object.values(TIPOS).map(t => `<span><i style="background:${t.fill};border-color:${t.stripe}"></i>${t.nome}</span>`).join('');
}

function renderRibbon(){
  const g = curGroup(), rb = $('#ribbon');
  if(ui.phase === 'idle') rb.innerHTML = `${chipHtml(state.cur)}<b>${esc(g.name)}</b><span class="hint">lance o dado</span><kbd>Espaço</kbd>`;
  else if(ui.phase === 'skip') rb.innerHTML = `${chipHtml(state.cur)}<b>${esc(g.name)}</b><span class="hint">perde esta vez</span><kbd>Espaço</kbd>`;
  else rb.innerHTML = `${chipHtml(state.cur)}<b>${esc(g.name)}</b>`;
}

/* ==================================================================
   FLUXO DO TURNO
   ================================================================== */
function beginTurn(){
  ui.pb = false; ui.piada = null;
  ui.history.push(JSON.stringify(state));
  if(ui.history.length > 30) ui.history.shift();
  save();
  const g = curGroup();
  if(g.skip){ g.skip = false; ui.phase = 'skip'; } else ui.phase = 'idle';
  renderAll();
  checaContinuidade();
}
/* Na metade da partida, equipe com zero pontos ganha a ressalva de continuidade (NBC TA 570) */
function checaContinuidade(){
  if(state.metadeVista) return;
  const metade = state.relogio ? state.relogio.restante <= state.relogio.total / 2 : state.round > state.rounds / 2;
  if(!metade) return;
  state.metadeVista = true;
  const zeradas = state.groups.filter(g => g.pts === 0);
  if(!zeradas.length) return;
  zeradas.forEach(g => { g.continuidade = true; });
  ovo('continuidade operacional');
  toast(`Metade da partida. Continuidade operacional em dúvida: ${zeradas.map(g => g.name).join(', ')} (NBC TA 570).`);
  renderScores();
}

function primary(){
  if(!$('#confirm').hidden) return;
  if(ui.phase === 'idle') roll();
  else if(ui.phase === 'skip') endTurn();
  else if(ui.phase === 'card' && ui.card && ui.card.done) endTurn();
}

const PIPS = {1:[4],2:[0,8],3:[0,4,8],4:[0,2,6,8],5:[0,2,4,6,8],6:[0,2,3,5,6,8]};
function setDie(n){ [...$('#die').children].forEach((p, i) => p.classList.toggle('on', PIPS[n].includes(i))); }

async function roll(){
  ui.phase = 'rolling'; renderTurn(); renderRibbon(); sync();
  const die = $('#die'); die.classList.add('rolling');
  for(let k = 0; k < 10; k++){ setDie(1 + Math.floor(Math.random()*6)); sfx.tick(); await sleep(70); }
  const n = 1 + Math.floor(Math.random()*6);
  const doisSeis = ui.lastDie === 6 && n === 6;
  setDie(n); die.classList.remove('rolling'); ui.lastDie = n;
  toast(doisSeis ? `Dois 6 seguidos! Auditoria surpresa da CVM para ${curGroup().name}` : `${curGroup().name} tirou ${n}`);
  if(doisSeis){ ovo('auditoria surpresa'); telaGame('Auditoria surpresa', `dois 6 seguidos · ${curGroup().name} · vale o dobro`, true); }
  await sleep(450);
  ui.phase = 'moving'; renderTurn(); sync();
  await movePawn(state.cur, n);
  const g = curGroup();
  if(g.pos === CONFIG.CASA_FECHAMENTO){
    addPts(state.cur, CONFIG.PONTOS.fechamento); sfx.ok(); ovo('fechamento');
    toast(`Casa ${g.pos}, dezembro: fechamento do exercício! Balanço fechado no prazo, +${CONFIG.PONTOS.fechamento}.`);
    await sleep(1800);
  }
  const vizinhos = state.groups.filter((o, i) => i !== state.cur && o.pos === g.pos && g.pos > 0);
  if(vizinhos.length && state.conflitoRodada !== state.round){
    state.conflitoRodada = state.round;   // no máximo um aviso por rodada
    ovo('conflito de interesses');
    toast(`Conflito de interesses: ${g.name} e ${vizinhos.map(o => o.name).join(', ')} na mesma casa. Ameaça à independência!`);
    await sleep(1500);
  }
  if(doisSeis){ openCard('cvm'); return; }
  const tipo = TRILHA[g.pos - 1];
  toast(`Casa ${g.pos}: ${TIPOS[tipo].nome}`);
  openCard(tipo);
}

async function movePawn(gi, steps){
  const g = state.groups[gi], total = TRILHA.length;
  for(let k = 0; k < Math.abs(steps); k++){
    if(steps > 0){
      if(g.pos === total){
        g.pos = 0; renderPawns(); await sleep(300);
        g.pos = 1; g.voltas++;
        addPts(gi, CONFIG.PONTOS.volta); sfx.ok();
        toast(`Volta completa! Parecer emitido: +${CONFIG.PONTOS.volta} para ${g.name}`);
        telaGame('Parecer emitido', `+${CONFIG.PONTOS.volta} · ${g.name}`, true);
      } else {
        g.pos++;
        if(g.pos === CONFIG.CASA_REVISAO + 1 && g.revisao !== g.voltas){
          g.revisao = g.voltas; addPts(gi, CONFIG.PONTOS.revisao); sfx.ok(); ovo('revisão intermediária');
          toast(`Laço esquerdo completo: revisão intermediária aprovada, +${CONFIG.PONTOS.revisao} para ${g.name}`);
          telaGame('Revisado', `+${CONFIG.PONTOS.revisao} · revisão intermediária · ${g.name}`, true);
        }
      }
    } else {
      g.pos = Math.max(1, g.pos - 1);
    }
    sfx.step(); renderPawns(); renderScores();
    await sleep(300);
  }
  renderTurn();
}

function endTurn(){
  stopTimer();
  logCard();
  ui.card = null; $('#card-layer').hidden = true; $('#card-layer').innerHTML = '';
  state.cur++;
  if(state.cur >= state.groups.length){ state.cur = 0; state.round++; }
  if(state.round > state.rounds){ endGame(); return; }
  beginTurn();
}

/* Cartas que merecem discussão no fim */
function logCard(){
  const c = ui.card; if(!c) return;
  if(c.kind === 'q'){
    const missed = c.result !== 'ok';
    if(missed || c.flag) state.log.push({ id: c.q.id, tipo: c.tipo, pergunta: c.q.pergunta, resposta: c.q.alternativas[c.q.correta], explicacao: c.q.explicacao, missed, flag: !!c.flag });
  } else if(c.kind === 'dil'){
    if(!c.awarded || c.flag) state.log.push({ id: c.d.id, tipo: 'dil', pergunta: c.d.pergunta, resposta: c.d.pontosChave.join('; '), explicacao: c.d.situacao, missed: !c.awarded, flag: !!c.flag });
  } else if(c.kind === 'rel'){
    const missed = c.hits.length < state.groups.length / 2;
    if(missed || c.flag) state.log.push({ id: c.r.id, tipo: 'rel', pergunta: c.r.afirmacao, resposta: c.r.resposta ? 'Verdadeiro' : 'Falso', explicacao: c.r.explicacao, missed, flag: !!c.flag });
  }
}

function addPts(gi, n, voo = true){
  const g = state.groups[gi], antes = ui.ptsVis[gi] != null ? ui.ptsVis[gi] : g.pts;
  g.pts = Math.max(0, g.pts + n);
  if(n > 0 && voo && !$('#app').hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches){
    ui.ptsVis[gi] = antes; renderScores(); voarPontos(gi, n, antes);
  } else { delete ui.ptsVis[gi]; renderScores(); }
}
/* "+20" sai da carta (ou do pino) e voa até o placar; lá o número sobe contando */
function voarPontos(gi, n, de){
  const alvo = document.querySelector(`.score-row[data-gi="${gi}"] .pts`);
  const fonte = !$('#card-layer').hidden ? ($('#card-layer .verdict') || $('#card-layer .card')) : document.getElementById('pawn-' + gi);
  if(!alvo || !fonte){ delete ui.ptsVis[gi]; renderScores(); return; }
  const a = fonte.getBoundingClientRect(), b = alvo.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'voo num'; el.textContent = '+' + n;
  el.style.setProperty('--team', team(gi).cor); el.style.setProperty('--team-ink', textColor(team(gi).cor));
  el.style.left = (a.left + a.width / 2) + 'px'; el.style.top = (a.top + a.height / 2) + 'px';
  el.style.setProperty('--dx', (b.left + b.width / 2 - a.left - a.width / 2) + 'px');
  el.style.setProperty('--dy', (b.top + b.height / 2 - a.top - a.height / 2) + 'px');
  document.body.appendChild(el);
  const token = (ui.vooTok[gi] = (ui.vooTok[gi] || 0) + 1);
  setTimeout(() => {
    el.remove();
    if(ui.vooTok[gi] !== token) return;
    const ate = state.groups[gi].pts, t0 = performance.now(), dur = 650;
    const passo = now => {
      if(ui.vooTok[gi] !== token) return;
      const k = Math.min(1, (now - t0) / dur), v = Math.round(de + (ate - de) * (1 - Math.pow(1 - k, 3)));
      ui.ptsVis[gi] = v;
      const p = document.querySelector(`.score-row[data-gi="${gi}"] .pts`);
      if(p){ p.textContent = v; p.classList.add('subindo'); }
      if(k < 1) requestAnimationFrame(passo);
      else { delete ui.ptsVis[gi]; if(p) setTimeout(() => p.classList.remove('subindo'), 250); sfx.tick(); }
    };
    requestAnimationFrame(passo);
  }, 900);
}

function undo(){
  if(!ui.history.length || ui.phase === 'rolling' || ui.phase === 'moving') return;
  askConfirm('Desfazer o turno atual? O placar e os pinos voltam para o início deste turno.', 'Desfazer turno', () => {
    stopTimer(); ui.card = null; $('#card-layer').hidden = true;
    if(ui.phase === 'idle' || ui.phase === 'skip'){ if(ui.history.length > 1) ui.history.pop(); }
    const relogio = state.relogio;
    state = JSON.parse(ui.history[ui.history.length - 1]);
    ui.ptsVis = {}; ui.vooTok = {};
    ovo('pivô'); setTimeout(() => toast('Pivô! Pivô! Pivô! Turno desfeito.'), 100);
    ui.history.pop();
    if(relogio) state.relogio = relogio;   // desfazer não devolve tempo de jogo
    renderBoard(); beginTurn();
    toast('Turno desfeito');
  });
}

/* ==================================================================
   CARTAS
   ================================================================== */
/* Histórico entre partidas (fica neste computador): cada partida prefere perguntas
   que ainda não saíram em partidas anteriores. Quando um baralho acaba, ele recomeça. */
const HIST_KEY = 'trilha-historico-perguntas';
function historico(){ try{ return JSON.parse(localStorage.getItem(HIST_KEY)) || {}; }catch(e){ return {}; } }
function guardaHistorico(h){ try{ localStorage.setItem(HIST_KEY, JSON.stringify(h)); }catch(e){} }
function marcaHistorico(key, id){ const h = historico(); (h[key] = h[key] || []); if(!h[key].includes(id)) h[key].push(id); guardaHistorico(h); }
function ineditas(){
  const h = historico(), baralhos = Object.assign({}, DECKS, { mm: MATAMATA });
  let livres = 0, total = 0;
  for(const k in baralhos){ total += baralhos[k].length; livres += baralhos[k].filter(x => !(h[k] || []).includes(x.id)).length; }
  return { livres, total };
}
function sorteiaSemRepetir(key, deck, usadasNaPartida){
  const h = historico(), ja = h[key] || [];
  let free = deck.filter(x => !usadasNaPartida.includes(x.id) && !ja.includes(x.id));
  if(!free.length){
    // tudo já saiu em partidas anteriores: recomeça o baralho, mas sem repetir dentro desta partida
    h[key] = []; guardaHistorico(h);
    free = deck.filter(x => !usadasNaPartida.includes(x.id));
  }
  return free.length ? free[Math.floor(Math.random() * free.length)] : null;
}
function draw(key){
  const deck = DECKS[key];
  let it = sorteiaSemRepetir(key, deck, state.used[key]);
  if(!it){ state.used[key] = []; it = sorteiaSemRepetir(key, deck, []); }
  state.used[key].push(it.id);
  marcaHistorico(key, it.id);
  return it;
}
function shuffled(q){
  const order = q.alternativas.map((_, i) => i).sort(() => Math.random() - 0.5);
  const parcial = {};
  if(q.parcial) for(const k in q.parcial) parcial[order.indexOf(+k)] = q.parcial[k];
  return Object.assign({}, q, { alternativas: order.map(i => q.alternativas[i]), correta: order.indexOf(q.correta), parcial });
}
function efeitoTxt(ef){
  return ef.pts !== undefined ? `${ef.pts > 0 ? '+' : ''}${ef.pts} pontos` : (ef.mover > 0 ? `Avance ${ef.mover} casa${ef.mover > 1 ? 's' : ''}` : `Volte ${-ef.mover} casa${ef.mover < -1 ? 's' : ''}`);
}

function openCard(tipo){
  ui.phase = 'card'; renderTurn(); renderRibbon(); sfx.card();
  const who = state.cur;
  if(tipo === 'cvm'){
    const r = RELAMPAGO[Math.floor(Math.random() * RELAMPAGO.length)];
    const q = { id: 'CVM-' + r.id.slice(4), nivel: 'cvm', tema: 'Auditoria surpresa da CVM', norma: 'Verdadeiro ou falso',
      pergunta: r.afirmacao, alternativas: ['Verdadeiro', 'Falso'], correta: r.resposta ? 0 : 1, explicacao: r.explicacao };
    ui.card = { kind: 'q', tipo, q, who, stage: 'answer', steal: false, tried: [who], wrong: [], done: false, flag: false, pending: null };
    startTimer(CONFIG.TEMPO_RELAMPAGO);
  } else if(Q_TYPES.includes(tipo)){
    const q = shuffled(draw(tipo));
    ui.card = { kind: 'q', tipo, q, who, stage: 'answer', steal: false, tried: [who], wrong: [], done: false, flag: false, pending: null };
    startTimer(state.tempo + (tipo === 'caso' || tipo === 'real' ? CONFIG.TEMPO_EXTRA_CASO : 0));
  } else if(tipo === 'dil'){
    // dilema: a equipe escolhe a conduta no celular; a melhor vale 40 e as aceitáveis valem parte
    const q = shuffled(draw('dil'));
    ui.card = { kind: 'q', tipo, q, who, stage: 'answer', steal: false, tried: [who], wrong: [], done: false, flag: false, pending: null };
    startTimer(state.tempo + CONFIG.TEMPO_EXTRA_CASO);
  } else if(tipo === 'rel'){
    ui.card = { kind: 'rel', tipo, r: draw('rel'), who, stage: 'answer', hits: [], vf: {}, done: false, flag: false };
    startTimer(CONFIG.TEMPO_RELAMPAGO);
  } else if(tipo === 'sorte'){
    ui.card = { kind: 'ev', tipo, e: EVENTOS[Math.floor(Math.random()*EVENTOS.length)], who, stage: 'show', done: false };
  } else {
    ui.card = { kind: 'pausa', tipo, e: PAUSAS[Math.floor(Math.random()*PAUSAS.length)], who, stage: 'show', done: false };
  }
  ui.card.t0 = Date.now();
  $('#card-layer').hidden = false;
  renderCard();
}

function qPoints(c){ const base = CONFIG.PONTOS[c.q.nivel]; return c.steal ? Math.round(base * CONFIG.ROUBO_FRACAO) : base; }
const roubosRestantes = i => CONFIG.ROUBOS_POR_EQUIPE - (state.groups[i].roubos || 0);
const podemRoubar = c => state.groups.map((g, i) => i).filter(i => !c.tried.includes(i) && roubosRestantes(i) > 0);

function band(title, meta, withTimer){
  return `<div class="card-band"><div class="cat"><span class="cat-name">${title}</span><span class="cat-meta">${meta}</span></div>
    ${withTimer ? `<div class="timer"><span class="t-num num" id="t-num"></span><button class="t-btn" data-act="pause" id="t-pause">Pausar</button></div>` : ''}</div>
    ${withTimer ? '<div class="t-track"><div id="t-bar"></div></div>' : ''}`;
}
function whoLine(gi, label, extra){
  return `<div class="who">${chipHtml(gi)}<span>${label || 'Responde'}: <b>${esc(state.groups[gi].name)}</b></span>${extra || ''}</div>`;
}
function flagBtn(c){
  return `<button class="cbtn flag ${c.flag ? 'on' : ''}" data-act="flag">${c.flag ? 'Marcada para discussão' : 'Marcar para discussão'} <kbd>M</kbd></button>`;
}
function verdictHtml(){
  if(!ui.piada) return '';
  return `<div class="verdict ${ui.piada.tipo}"><span>${esc(ui.piada.txt)}<small>${esc(ui.piada.sub || '')}</small></span></div>`;
}

function renderCard(){
  const c = ui.card;
  if(!c){ sync(); return; }
  const t = TIPOS[c.tipo] || { nome: 'Auditoria surpresa da CVM' };
  const cat = c.tipo === 'real' ? '#262A36' : c.tipo === 'cvm' ? '#7A2E27' : INK;
  let h = `<div class="card" style="--cat:${cat}">`;
  const timing = ui.timer && !c.done && (c.stage === 'answer' || c.stage === 'debate');

  if(c.kind === 'q'){
    const q = c.q, pts = qPoints(c), isReal = c.tipo === 'real';
    const house = '';   // equipes são fictícias: sem ligação com as firmas dos casos reais
    const cap = capitao(c.who);
    const phone = state.sala && c.stage === 'answer' ? `<span class="tag phone">${cap ? `${esc(cap.nome)} responde pelo celular` : 'sem celular: o professor marca'}</span>` : '';
    const title = isReal ? `${esc(q.caso)} · ${esc(q.ano)}` : t.nome;
    h += band(title, `${q.id} · ${NIVEL[q.nivel]} · ${esc(q.tema)} · ${pts} pontos${q.risco ? ` · Nível de risco <span class="estrelas">${'★'.repeat(q.risco)}<i>${'★'.repeat(5 - q.risco)}</i></span>` : ''}`, timing);
    if(isReal) h += `<div class="stamp">CASO REAL</div>`;
    if(c.tipo === 'cvm') h += `<div class="stamp">DOIS 6 SEGUIDOS · VALE O DOBRO</div>`;
    if(c.stage === 'reveal' && c.result === 'ok' && DIFICEIS.includes(q.nivel)) h += `<div class="carimbo ${c.carimbado ? '' : 'bate'}">AUDITADO</div>`;
    h += `<div class="card-body">${whoLine(c.who, '', (c.steal ? `<span class="tag steal">Roubo de Evidência · vale ${pts}</span>` : '') + house + phone)}`;
    if(q.contexto) h += `<p class="situacao">${esc(q.contexto)}</p>`;
    h += `<p class="q-text">${esc(q.pergunta)}</p>`;
    if(c.stage !== 'answer' || c.wrong.length) h += verdictHtml();
    h += `<div class="alts">`;
    q.alternativas.forEach((a, i) => {
      let cls = '';
      if(c.stage === 'reveal'){ cls = i === q.correta ? 'right' : (q.parcial && q.parcial[i] ? 'partial' : (c.wrong.includes(i) ? 'wrong' : 'dim')); }
      else if(c.wrong.includes(i)) cls = 'wrong';
      if(c.pending === i) cls = 'pending';
      const dis = c.stage !== 'answer' || c.wrong.includes(i) || c.pending != null;
      const valeAlt = c.stage === 'reveal' && q.nivel === 'dilema' ? `<small class="alt-pts">${i === q.correta ? CONFIG.PONTOS.dilema : (q.parcial && q.parcial[i]) || 0} pts</small>` : '';
      h += `<button class="alt ${cls}" data-act="alt" data-i="${i}" ${dis ? 'disabled' : ''}><span class="lt">${LETRAS[i]}</span><span>${esc(a)}</span>${valeAlt}</button>`;
    });
    h += `</div>`;
    if(c.stage === 'reveal'){
      const ok = c.result === 'ok' || c.result === 'parcial';
      h += `<div class="explain"><div class="res">${ok ? `+${c.awarded} para ${esc(state.groups[c.winner].name)}${c.result === 'parcial' ? ' (conduta aceitável)' : ''}` : 'Ninguém acertou'}</div>${esc(q.explicacao)}<br><span class="norma">Referência: ${esc(q.norma)}${isReal ? ' · Fonte: ' + esc(q.fonte) : ''}</span></div>`;
      if(isReal && q.piada) h += `<div class="joke"><b>Para descontrair</b><span>${esc(q.piada)}</span></div>`;
    }
    h += `</div><div class="card-foot">`;
    if(c.stage === 'answer'){
      const timeout = ui.timer && ui.timer.expired;
      const msg = c.pending != null ? `<b>${esc(state.groups[c.who].name)}</b> respondeu ${LETRAS[c.pending]}…`
        : `${timeout ? '<b>Tempo esgotado.</b> ' : ''}${cap && state.sala ? 'Aguardando a resposta pelo celular, ou clique na alternativa dita (1 a 4).' : 'Clique na alternativa que a equipe disse (teclas 1 a 4).'}`;
      h += `<span class="note">${msg}</span><button class="cbtn bad" data-act="nope">Não respondeu</button>`;
    } else if(c.stage === 'steal'){
      const others = podemRoubar(c);
      h += `<span class="note"><b>Errou.</b> Roubo de Evidência valendo ${Math.round(CONFIG.PONTOS[q.nivel]*CONFIG.ROUBO_FRACAO)}: o primeiro capitão que pedir no celular leva a vez, ou escolha aqui. Cada equipe rouba uma vez por partida.</span>`;
      h += others.map(i => `<button class="cbtn group" data-act="steal" data-g="${i}">${chipHtml(i)}${esc(state.groups[i].name)}</button>`).join('');
      h += `<button class="cbtn primary" data-act="nosteal">Ninguém rouba, revelar</button>`;
    } else {
      h += `<span class="note">Comente a resposta com a turma.</span>${flagBtn(c)}<button class="cbtn primary" data-act="next">Próximo turno <kbd>Espaço</kbd></button>`;
    }
    h += `</div>`;

  } else if(c.kind === 'dil'){
    const d = c.d, P = CONFIG.PONTOS.dilema;
    h += band(t.nome, `${d.id} · ${esc(d.tema)} · até ${P} pontos`, timing);
    h += `<div class="card-body">${whoLine(c.who)}<p class="situacao">${esc(d.situacao)}</p><p class="q-text">${esc(d.pergunta)}</p>`;
    if(c.stage === 'done') h += verdictHtml();
    if(c.stage !== 'debate'){
      h += `<div class="explain"><div class="res">Pontos-chave esperados</div><ul class="keys">${d.pontosChave.map(k => `<li>${esc(k)}</li>`).join('')}</ul><span class="norma">Referência: ${esc(d.norma)}</span></div>`;
    }
    h += `</div><div class="card-foot">`;
    if(c.stage === 'debate') h += `<span class="note">A equipe argumenta em voz alta. Depois, mostre os pontos-chave.</span><button class="cbtn primary" data-act="keys">Mostrar pontos-chave</button>`;
    else if(c.stage === 'judge') h += `<span class="note">Avalie a resposta da equipe:</span>
      <button class="cbtn good" data-act="award" data-f="1">Completa +${P}</button>
      <button class="cbtn" data-act="award" data-f="0.5">Parcial +${Math.round(P/2)}</button>
      <button class="cbtn bad" data-act="award" data-f="0">Insuficiente 0</button>`;
    else h += `<span class="note">${c.awarded ? `+${c.awarded} para ${esc(state.groups[c.who].name)}` : '0 pontos'}. Alguém discorda?</span>${flagBtn(c)}<button class="cbtn primary" data-act="next">Próximo turno <kbd>Espaço</kbd></button>`;
    h += `</div>`;

  } else if(c.kind === 'rel'){
    const r = c.r, P = CONFIG.PONTOS.relampago;
    h += band('Relâmpago: todas as equipes', `${r.id} · Verdadeiro ou falso · ${P} pontos por equipe`, timing);
    const resp = state.groups.map((g, i) => `<span class="chip ${c.vf[i] !== undefined ? 'on' : ''}" style="background:${team(i).cor};color:${textColor(team(i).cor)}">${esc(team(i).sigla)}</span>`).join('');
    h += `<div class="card-body"><div class="who"><span>${state.sala ? 'Os capitães respondem V ou F no celular. Equipes sem celular levantam a mão.' : 'Cada equipe escreve <b>V</b> ou <b>F</b> num papel e levanta quando o tempo acabar.'}</span></div>
      <p class="q-text">${esc(r.afirmacao)}</p>`;
    if(state.sala && c.stage === 'answer') h += `<div class="answered">Já responderam: ${resp}</div>`;
    if(c.stage !== 'answer'){
      h += `<div class="vf"><div class="${r.resposta ? 'right' : ''}">Verdadeiro</div><div class="${!r.resposta ? 'right' : ''}">Falso</div></div>
        <div class="explain">${esc(r.explicacao)}</div>`;
    }
    h += `</div><div class="card-foot">`;
    if(c.stage === 'answer') h += `<span class="note">Quando todas tiverem respondido, revele.</span><button class="cbtn primary" data-act="reveal">Revelar resposta</button>`;
    else if(c.stage === 'mark'){
      h += `<span class="note">Confira quem acertou (as respostas dos celulares já vêm marcadas):</span>` + state.groups.map((g, i) =>
        `<button class="cbtn group ${c.hits.includes(i) ? 'on' : ''}" data-act="hit" data-g="${i}">${chipHtml(i)}${esc(g.name)}</button>`).join('') +
        `<button class="cbtn primary" data-act="rel-ok">Confirmar pontos</button>`;
    } else h += `<span class="note">${c.hits.length ? `+${P} para ${c.hits.length} equipe${c.hits.length > 1 ? 's' : ''}` : 'Ninguém acertou'}</span>${flagBtn(c)}<button class="cbtn primary" data-act="next">Próximo turno <kbd>Espaço</kbd></button>`;
    h += `</div>`;

  } else if(c.kind === 'ev'){
    const e = c.e, ef = e.efeito, good = (ef.pts || ef.mover) > 0;
    h += band(good ? 'Sorte!' : 'Revés!', esc(e.titulo), false);
    h += `<div class="card-body">${whoLine(c.who, 'Equipe')}<p class="event-text">${esc(e.texto)}</p><div class="event-effect">${efeitoTxt(ef)}</div></div>
      <div class="card-foot"><span class="note"></span>${c.stage === 'show' ? '<button class="cbtn primary" data-act="apply">Aplicar</button>' : '<button class="cbtn primary" data-act="next">Próximo turno <kbd>Espaço</kbd></button>'}</div>`;

  } else {
    const e = c.e;
    h += band('Perde a vez', esc(e.titulo), false);
    h += `<div class="card-body">${whoLine(c.who, 'Equipe')}<p class="event-text">${esc(e.texto)}</p><div class="event-effect">Fica sem jogar na próxima rodada</div></div>
      <div class="card-foot"><span class="note"></span><button class="cbtn primary" data-act="next">Próximo turno <kbd>Espaço</kbd></button></div>`;
    if(!c.applied){ state.groups[c.who].skip = true; c.applied = true; c.done = true; renderScores(); }
  }
  h += `</div>`;
  $('#card-layer').innerHTML = h;
  paintTimer();
  sync();
}

/* Ações dentro das cartas */
$('#card-layer').addEventListener('click', e => {
  const b = e.target.closest('[data-act]'); if(!b || b.disabled) return;
  const act = b.dataset.act, c = ui.card; if(!c) return;
  if(act === 'pause') return togglePause();
  if(act === 'next') return c.done && endTurn();
  if(act === 'flag'){ c.flag = !c.flag; renderCard(); return; }
  if(act === 'alt') return chooseAlt(+b.dataset.i);
  if(act === 'nope') return chooseAlt(-1);
  if(act === 'steal') return roubar(+b.dataset.g);
  if(act === 'nosteal'){ revealQ(); return; }
  if(act === 'keys'){ stopTimer(); c.stage = 'judge'; renderCard(); return; }
  if(act === 'award'){
    const P = Math.round(CONFIG.PONTOS.dilema * +b.dataset.f);
    c.awarded = P; c.stage = 'done'; c.done = true;
    if(P){ addPts(c.who, P); state.groups[c.who].ok++; acertou(c.who); sequencia(c.who, true); } else { state.groups[c.who].err++; errou(c.who); sequencia(c.who, false); }
    renderCard(); renderScores(); return;
  }
  if(act === 'reveal'){ revelarRelampago(); return; }
  if(act === 'hit'){ const i = +b.dataset.g; c.hits = c.hits.includes(i) ? c.hits.filter(x => x !== i) : c.hits.concat(i); renderCard(); return; }
  if(act === 'rel-ok'){
    c.hits.forEach(i => { addPts(i, CONFIG.PONTOS.relampago); state.groups[i].ok++; });
    c.stage = 'done'; c.done = true; if(c.hits.length) sfx.ok(); renderCard(); renderScores(); return;
  }
  if(act === 'apply'){ applyEvent(); return; }
});

function piadaDe(tipo, gi){
  const g = state.groups[gi];
  const pe = g && g.name === team(gi).firma && typeof PIADAS_EQUIPE !== 'undefined' ? PIADAS_EQUIPE[g.name] : null;
  if(pe && pe[tipo] && Math.random() < 0.35) return pe[tipo][Math.floor(Math.random() * pe[tipo].length)];
  return piada(tipo);
}
/* "Sem ressalvas": título para quem acerta várias seguidas, perdido no primeiro erro */
function sequencia(gi, acerto){
  const g = state.groups[gi];
  const antes = g.seq || 0;
  g.seq = acerto ? antes + 1 : 0;
  if(acerto && g.seq === CONFIG.SEQUENCIA_SEM_RESSALVAS){ ovo('sem ressalvas'); setTimeout(() => toast(`${g.name}: ${g.seq} acertos seguidos. Parecer SEM RESSALVAS! O Lineu aprovaria.`), 1600); }
  if(!acerto && antes >= CONFIG.SEQUENCIA_SEM_RESSALVAS) setTimeout(() => toast(`${g.name} perdeu o título Sem ressalvas.`), 1600);
}
const semRessalvas = g => (g.seq || 0) >= CONFIG.SEQUENCIA_SEM_RESSALVAS;
function acertou(gi){ ui.pb = false; ui.piada = { tipo: 'ok', txt: piadaDe('ok', gi) }; sfx.ok(); }
function errou(gi, nivel){
  const ja = ui.pb;
  ui.pb = true; ui.piada = { tipo: 'no', txt: piadaDe('no', gi) }; sfx.bad();
  // Vergonha! Vergonha! (às vezes, quando erra pergunta fácil)
  if(nivel === 'facil' && Math.random() < 0.5){ ovo('vergonha'); ui.piada.txt = 'Vergonha! Vergonha! Vergonha!'; [0.5, 1.3, 2.1].forEach(s => tone(1320, 0.5, 'sine', 0.05, s)); }
  if(!ja){ telaGame('Ressalvado'); ovo('ressalvado'); }
}
/* Letreiro de videogame por cima da tela (some sozinho) */
function telaGame(txt, sub, passed){
  const d = document.createElement('div');
  d.className = 'wasted' + (passed ? ' passed' : '');
  // letreiros em imagem pronta (fonte Pricedown, Typodermic): a licença permite arte fixa, não a fonte no site
  const arq = { 'Ressalvado': 'ressalvado', 'Parecer emitido': 'parecer-emitido', 'Cheat negado': 'cheat-negado', 'Revisado': 'revisado', 'Rodada final': 'rodada-final', 'Auditoria surpresa': 'auditoria-surpresa' }[txt];
  const titulo = arq ? `<img src="img/${arq}.png?v=${Rede.VERSAO}" alt="${esc(txt)}">` : esc(txt);
  d.innerHTML = `<span>${titulo}${sub ? `<small>${esc(sub)}</small>` : ''}</span>`;
  document.body.appendChild(d); setTimeout(() => d.remove(), 2000);
}

function chooseAlt(i){
  const c = ui.card; if(!c || c.kind !== 'q' || c.stage !== 'answer') return;
  if(i >= 0 && (i >= c.q.alternativas.length || c.wrong.includes(i))) return;
  c.pending = null;
  stopTimer();
  if(i === c.q.correta){
    const pts = qPoints(c);
    addPts(c.who, pts); state.groups[c.who].ok++;
    c.awarded = pts; c.winner = c.who; c.result = 'ok'; c.stage = 'reveal'; c.done = true;
    if(c.steal) state.groups[c.who].rouboPts = (state.groups[c.who].rouboPts || 0) + pts;
    acertou(c.who); ui.piada.sub = `+${pts} para ${state.groups[c.who].name}`;
    const seg = (Date.now() - (c.t0 || Date.now())) / 1000;
    if(c.steal){
      ovo('delação premiada'); ui.piada.txt = 'Delação premiada aceita: a evidência roubada valeu pontos.';
      ovo('casamento vermelho'); toast(`Casamento Vermelho: ${state.groups[c.tried[0]].name} foi emboscada por ${state.groups[c.who].name}.`);
    } else if(seg < 6 && c.viaCelular){ ovo('resposta rápida'); ui.piada.txt = `Analytics de ponta: resposta certa em ${seg.toFixed(1)} s.`; }
    sequencia(c.who, true);
    renderCard(); c.carimbado = true;
    if(DIFICEIS.includes(c.q.nivel)) setTimeout(sfx.stamp, 250);
    renderScores(); return;
  }
  const meia = i >= 0 && c.q.parcial && c.q.parcial[i];
  if(meia){
    // conduta aceitável, mas não a melhor: leva parte dos pontos e a carta termina
    const pts = c.steal ? Math.round(meia * CONFIG.ROUBO_FRACAO) : meia;
    addPts(c.who, pts);
    c.awarded = pts; c.winner = c.who; c.result = 'parcial'; c.escolha = i; c.stage = 'reveal'; c.done = true;
    if(c.steal) state.groups[c.who].rouboPts = (state.groups[c.who].rouboPts || 0) + pts;
    ui.pb = false; ui.piada = { tipo: 'ok', txt: 'Conduta aceitável, mas não a melhor.', sub: `+${pts} para ${state.groups[c.who].name}` }; sfx.ok();
    renderCard(); renderScores(); return;
  }
  if(i >= 0) c.wrong.push(i);
  state.groups[c.who].err++;
  sequencia(c.who, false);
  errou(c.who, c.q.nivel);
  if(c.viaCelular && (Date.now() - (c.t0 || Date.now())) < 6000){ ovo('resposta rápida'); ui.piada.txt = 'Nem leu a NBC. Resposta em menos de 6 segundos.'; }
  ui.piada.sub = i >= 0 ? `${state.groups[c.who].name} marcou ${LETRAS[i]}` : `${state.groups[c.who].name} não respondeu`;
  if(!c.steal && podemRoubar(c).length){ c.stage = 'steal'; renderCard(); }
  else revealQ();
  renderScores();
}
function roubar(g){
  const c = ui.card; if(!c || c.stage !== 'steal') return;
  c.steal = true; c.who = g; c.tried.push(g); c.stage = 'answer';
  state.groups[g].roubos = (state.groups[g].roubos || 0) + 1;
  toast(`${state.groups[g].name} fez o Roubo de Evidência!`);
  startTimer(CONFIG.TEMPO_ROUBO); renderCard(); renderScores();
}
function revealQ(){ const c = ui.card; c.result = 'no'; c.stage = 'reveal'; c.done = true; stopTimer(); renderCard(); }

function revelarRelampago(){
  const c = ui.card; if(!c || c.kind !== 'rel' || c.stage !== 'answer') return;
  stopTimer();
  c.hits = Object.keys(c.vf).map(Number).filter(i => c.vf[i] === c.r.resposta);
  c.stage = 'mark'; renderCard();
}

async function applyEvent(){
  const c = ui.card, ef = c.e.efeito;
  c.stage = 'applying'; renderCard();
  if(ef.pts !== undefined){ addPts(c.who, ef.pts); if(ef.pts < 0) state.groups[c.who].perdas = (state.groups[c.who].perdas || 0) - ef.pts; ef.pts > 0 ? sfx.ok() : sfx.bad(); }
  else { $('#card-layer').hidden = true; await movePawn(c.who, ef.mover); $('#card-layer').hidden = false; }
  c.stage = 'done'; c.done = true; renderCard(); renderScores();
}

/* ==================================================================
   CRONÔMETRO
   ================================================================== */
function startTimer(sec){
  stopTimer();
  ui.timer = { total: sec, left: sec, running: true, expired: false };
  ui.timer.h = setInterval(() => {
    const t = ui.timer; if(!t || !t.running) return;
    t.left--;
    if(t.left <= 5 && t.left > 0) sfx.tick();
    if(t.left <= 0){ t.left = 0; t.running = false; t.expired = true; clearInterval(t.h); sfx.end(); if(ui.card) renderCard(); }
    paintTimer(); sync();
  }, 1000);
}
function stopTimer(){ if(ui.timer){ clearInterval(ui.timer.h); } ui.timer = null; }
function togglePause(){
  const t = ui.timer; if(!t || t.expired) return;
  t.running = !t.running; paintTimer(); sync(); toast(t.running ? 'Tempo retomado' : 'Tempo pausado');
}
function paintTimer(){
  const t = ui.timer, num = $('#t-num'), bar = $('#t-bar'), pb = $('#t-pause');
  if(!t || !num) return;
  num.textContent = t.left; num.classList.toggle('warn', t.left <= 10);
  if(bar){ bar.style.width = (t.left / t.total * 100) + '%'; bar.classList.toggle('warn', t.left <= 10); }
  if(pb){ pb.textContent = t.running ? 'Pausar' : (t.expired ? 'Esgotado' : 'Retomar'); }
}

/* ==================================================================
   SEGREDO: digite ENRON na TV para triturar a carta (ou o tabuleiro)
   ================================================================== */
let segredo = '';
function triturar(){
  const alvo = document.querySelector('#card-layer:not([hidden]) .card') || $('#board');
  const r = alvo.getBoundingClientRect(), tiras = 14, w = r.width / tiras;
  sfx.shred();
  setTimeout(() => toast('Documentos triturados. A Arthur Andersen mandou lembranças.'), 2700);
  const layer = document.createElement('div');
  layer.style.cssText = 'position:fixed;inset:0;z-index:90;pointer-events:none;overflow:hidden';
  for(let k = 0; k < tiras; k++){
    const box = document.createElement('div');
    box.style.cssText = `position:absolute;left:${r.left + k*w}px;top:${r.top}px;width:${w}px;height:${r.height}px;overflow:hidden`;
    const clone = alvo.cloneNode(true);
    clone.removeAttribute('id');
    clone.style.cssText = `position:absolute;left:${-k*w}px;top:0;width:${r.width}px;height:${r.height}px;margin:0;animation:none`;
    box.appendChild(clone);
    box.animate([{ transform: 'translateY(0) rotate(0)' }, { transform: `translateY(${window.innerHeight}px) rotate(${(Math.random()*16-8).toFixed(1)}deg)` }],
      { duration: 1400 + Math.random()*600, delay: 250 + k*45, easing: 'cubic-bezier(.5,0,.9,.6)', fill: 'forwards' });
    layer.appendChild(box);
  }
  alvo.style.visibility = 'hidden';
  document.body.appendChild(layer);
  setTimeout(() => { layer.remove(); alvo.style.visibility = ''; }, 2900);
}

/* ==================================================================
   RELÓGIO DA PARTIDA (modo por tempo)
   ================================================================== */
let ultimoTique = Date.now();
setInterval(() => {
  const agora = Date.now(), dt = (agora - ultimoTique) / 1000; ultimoTique = agora;
  if(!state || state.phase !== 'play' || !state.relogio || state.relogio.acabou || ui.relogioPausado || $('#app').hidden) return;
  const rl = state.relogio, antes = Math.ceil(rl.restante);
  rl.restante = Math.max(0, rl.restante - dt);
  if(rl.restante <= 0){
    rl.acabou = true;
    state.rounds = state.round;        // termina ao fim da rodada em andamento
    toast('Tempo de jogo esgotado: esta é a rodada final.'); sfx.end();
    ovo('rodada final'); telaGame('Rodada final', 'o tempo acabou · a rodada em andamento vai até o fim');
    save();
  } else if(antes > 300 && rl.restante <= 300) { ovo('fechamento chegando'); toast('O fechamento está chegando: faltam 5 minutos de jogo.'); }
  if(Math.ceil(rl.restante) !== antes){ renderHeader(); if(Math.ceil(rl.restante) % 5 === 0) sync(); }
  if(Math.ceil(rl.restante) % 15 === 0) save();
}, 1000);
function toggleRelogio(){
  if(!state || !state.relogio){ toast('Esta partida não tem relógio (modo por rodadas).'); return; }
  ui.relogioPausado = !ui.relogioPausado;
  $('#m-clock').innerHTML = `${ui.relogioPausado ? 'Retomar' : 'Pausar'} relógio da partida <kbd>R</kbd>`;
  renderHeader(); sync();
  toast(ui.relogioPausado ? 'Relógio da partida pausado' : 'Relógio da partida retomado');
}

/* Prêmios do fim da partida (só aparecem quando alguém se qualifica) */
function premios(){
  const gs = state.groups.map((g, i) => ({ g, i }));
  const top = (campo, min) => {
    const v = Math.max(...gs.map(o => o.g[campo] || 0));
    if(v < (min || 1)) return null;
    return gs.filter(o => (o.g[campo] || 0) === v);
  };
  const lista = [];
  const add = (titulo, desc, quem, valor) => { if(quem) lista.push({ titulo, desc, quem, valor }); };
  const ok = top('ok'); add('Prêmio Cynthia Cooper', 'mais respostas certas', ok, ok && ok[0].g.ok);
  const rb = top('rouboPts'); add('Ladrão de Evidências', 'mais pontos em Roubo de Evidência', rb, rb && rb[0].g.rouboPts + ' pts');
  const er = top('err'); add('Fragmentadora de Ouro', 'mais erros (a Arthur Andersen mandou lembranças)', er, er && er[0].g.err);
  const pd = top('perdas'); add('Prêmio Repo 105', 'mais pontos perdidos em revés', pd, pd && pd[0].g.perdas + ' pts');
  const vt = top('voltas'); add('Parecer emitido', 'mais voltas completas no tabuleiro', vt, vt && vt[0].g.voltas);
  const zero = gs.filter(o => o.g.pts === 0);
  if(zero.length) lista.push({ titulo: 'Parecer com abstenção de opinião', desc: 'terminou com zero pontos: não deu para formar opinião', quem: zero, valor: '0 pts' });
  return lista;
}

/* ==================================================================
   FIM DE JOGO E GABARITO
   ================================================================== */
function endGame(){
  stopTimer(); ui.card = null; ui.pb = false; ui.piada = null; $('#card-layer').hidden = true;
  state.phase = 'end'; save(); sync();
  const order = ranking();
  const tied = order.length > 1 && sameRank(order[0], order[1]) && state.desempate == null;
  // a revelação do pódio só roda na primeira vez (voltar do mata-mata mostra direto)
  const animar = !state.podioVisto; state.podioVisto = true;
  if(animar){ ui.revelaAte = Date.now() + 2600; sync(); setTimeout(sync, 2700); }   // celulares só veem o resultado depois da TV
  const decidido = order.length > 1 && sameRank(order[0], order[1]) && state.desempate != null;
  const pod = [1, 0, 2].map(k => {
    const o = order[k]; if(!o) return '';
    const t = team(o.i);
    return `<div class="pod p${k+1}" style="--d:${[2.1, 1.0, 0.2][k]}s;--team:${t.cor};--team-ink:${textColor(t.cor)}">${chipHtml(o.i)}<div class="pname">${esc(o.g.name)}</div><div class="ppts num">${o.g.pts} pontos</div><div class="bar">${k+1}º</div></div>`;
  }).join('');
  const nota = CONFIG.NOTA ? `<div class="nota"><b>Nota da atividade</b><span>${esc(CONFIG.NOTA.participacao)}</span><span>${esc(CONFIG.NOTA.vencedora)}${tied ? ` · <span class="tie">Empate no 1º lugar${state.sala && state.matamata !== false ? ': decida no mata-mata' : ''}</span>` : ''}${decidido ? ' · <span class="tie">Empate decidido no mata-mata</span>' : ''}</span></div>` : '';
  const labelTipo = k => (TIPOS[k] ? TIPOS[k].nome : k);
  const review = state.log.length
    ? state.log.map(l => `<div class="rv"><div><code>${esc(l.id)}</code><span class="why">${l.flag ? 'marcada' : ''}${l.flag && l.missed ? ' · ' : ''}${l.missed ? 'errada' : ''}</span></div><div>${esc(l.pergunta)}<br><span class="ans">${esc(l.resposta)}</span><div class="exp">${labelTipo(l.tipo)} · ${esc(l.explicacao)}</div></div></div>`).join('')
    : '<p>Nenhuma carta errada ou marcada nesta partida.</p>';
  $('#end-inner').classList.toggle('anim', animar);
  $('#end-inner').innerHTML = `
    <div class="setup-head" style="justify-content:space-between">
      <div><div class="eyebrow">FACC · UFRJ · Fim de partida</div><h1>Parecer final</h1></div>
      <div class="actions">${state.sala && state.matamata !== false ? `<button class="big main" id="btn-mm">${state.mm && state.mm.vencedor ? 'Mata-mata de novo' : 'Mata-mata: Auditor-Sócio'}</button>` : ''}<button class="big ghost" id="btn-new">Nova partida</button></div>
    </div>
    ${state.mm && state.mm.vencedor ? `<div class="socio-banner">${chipHtml(state.mm.vencedor.equipe)}<div><small>Auditor-Sócio da partida</small><b>${esc(state.mm.vencedor.nome)}</b></div></div>` : ''}
    <div class="end-podium ${animar ? 'anim' : ''}">${pod}</div>
    ${nota}
    <div class="panel" style="overflow-x:auto"><table class="end-table">
      <thead><tr><th>Posição</th><th>Equipe</th><th style="text-align:right">Pontos</th><th style="text-align:right">Acertos</th><th style="text-align:right">Erros</th><th style="text-align:right">Voltas</th></tr></thead>
      <tbody>${order.map((o, k) => `<tr><td>${k+1}º</td><td>${chipHtml(o.i)} ${esc(o.g.name)}</td><td class="n">${o.g.pts}</td><td class="n">${o.g.ok}</td><td class="n">${o.g.err}</td><td class="n">${o.g.voltas}</td></tr>`).join('')}</tbody>
    </table></div>
    ${(() => { const pr = premios(); return pr.length ? `<div class="panel"><h2 style="font-size:24px;margin-bottom:8px">Prêmios do parecer</h2><div class="awards">${pr.map(p => `<div class="award"><b>${esc(p.titulo)}</b><span>${p.quem.map(o => chipHtml(o.i) + ' ' + esc(o.g.name)).join(', ')}</span><small>${esc(p.desc)} · ${esc(p.valor)}</small></div>`).join('')}</div></div>` : ''; })()}
    <div class="panel review"><h2>Para retomar na discussão</h2><p>Cartas que ninguém acertou ou que você marcou durante a partida.</p>${review}</div>`;
  $('#app').hidden = true; $('#end').hidden = false; $('#end').scrollTop = 0;
  if($('#btn-mm')) $('#btn-mm').onclick = () => mmAbrir();
  $('#btn-new').onclick = () => {
    clearSave();
    if(sala){ sala.encerrar(); sala = null; }
    $('#end').hidden = true; $('#setup').hidden = false; buildSetup();
  };
  if(!animar) return;
  const vence = team(order[0].i).cor;
  [0.2, 1.0].forEach(s => setTimeout(sfx.card, s * 1000));
  for(let k = 0; k < 7; k++) setTimeout(sfx.tick, 1500 + k * 80);   // rufar antes do 1º
  setTimeout(() => { sfx.stamp(); setTimeout(sfx.ok, 250); }, 2200);
  for(let k = 0; k < 110; k++){
    const p = document.createElement('div');
    p.className = 'confetti';
    p.style.left = Math.random()*100 + 'vw';
    p.style.background = k % 3 ? vence : EQUIPES[k % Math.min(4, state.groups.length)].cor;
    p.style.animationDuration = (2.8 + Math.random()*2.5) + 's';
    p.style.animationDelay = (2.3 + Math.random()*1.5) + 's';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 9500);
  }
}

function openGabarito(){
  const sec = (title, items) => `<div class="gab-sec"><h2>${title}</h2>${items}</div>`;
  const qItems = list => list.map(q => `<div class="gab-item"><code>${q.id}</code><div>${q.caso ? '<b>' + esc(q.caso) + '.</b> ' : ''}${esc(q.pergunta)}<br><span class="ans">${esc(q.alternativas[q.correta])}</span></div></div>`).join('');
  $('#gab-inner').innerHTML = `
    <div class="setup-head" style="justify-content:space-between">
      <div><div class="eyebrow">Uso do professor</div><h1 style="font-size:40px">Gabarito do moderador</h1></div>
      <button class="big main" data-close="gab">Fechar</button>
    </div>
    <div class="warn-box">Não exiba esta tela na TV durante a partida. Cada carta mostra seu código (por exemplo, AU2-07) para você conferir aqui ou numa cópia impressa.</div>
    ${sec('Auditoria I', qItems(AUDITORIA))}
    ${sec('Auditoria II', qItems(AUDITORIA2))}
    ${sec('Ética', qItems(ETICA))}
    ${sec('Casos práticos', qItems(CASOS))}
    ${sec('Casos reais', qItems(REAIS))}
    ${sec('Dilemas éticos', DILEMAS.map(d => `<div class="gab-item"><code>${d.id}</code><div><span style="color:var(--ink-soft)">${esc(d.contexto)}</span><br>${esc(d.pergunta)}<br><span class="ans">40: ${esc(d.alternativas[d.correta])}</span>${Object.keys(d.parcial || {}).map(k => `<br><span class="ans">${d.parcial[k]}: ${esc(d.alternativas[k])}</span>`).join('')}</div></div>`).join(''))}
    ${sec('Relâmpago', RELAMPAGO.map(r => `<div class="gab-item"><code>${r.id}</code><div>${esc(r.afirmacao)} <span class="ans">${r.resposta ? 'Verdadeiro' : 'Falso'}</span></div></div>`).join(''))}`;
  $('#gab').hidden = false;
  $('#gab').scrollTop = 0;
}

/* ==================================================================
   CONTROLES
   ================================================================== */
$('#btn-start').onclick = newGame;
$('#btn-resume').onclick = resumeGame;
$('#btn-gab').onclick = openGabarito;
$('#m-gab').onclick = () => askConfirm('Abrir o gabarito? Ele mostra todas as respostas. Confira se a TV não está espelhando esta tela.', 'Abrir gabarito', openGabarito);
$('#m-rules').onclick = openHelp;
$('#m-undo').onclick = undo;
$('#m-pause').onclick = togglePause;
$('#m-full').onclick = toggleFull;
$('#m-sound').onclick = toggleSound;
$('#m-room').onclick = () => { if(state && state.sala) showLobby(); else toast('Esta partida está no modo só na TV.'); };
$('#room-badge').onclick = () => showLobby();
$('#m-clock').onclick = toggleRelogio;
$('#m-end').onclick = () => askConfirm('Encerrar a partida agora e mostrar o pódio?', 'Encerrar partida', endGame);
$('#btn-roll').onclick = primary;
$('#score-list').addEventListener('click', e => {
  const b = e.target.closest('[data-adj]'); if(!b) return;
  addPts(+b.dataset.adj, +b.dataset.d, false); save();
});
document.addEventListener('click', e => {
  const b = e.target.closest('[data-close]'); if(b) $('#' + b.dataset.close).hidden = true;
});

function openHelp(){ $('#rules-box-2').innerHTML = rulesHtml() + shortcutsHtml(); $('#help').hidden = false; }
function shortcutsHtml(){
  return `<h3 style="margin-top:16px">Atalhos do moderador</h3>
  <ol style="list-style:none;padding:0">
    <li><b>Espaço</b> ou <b>Enter</b>: lançar o dado / próximo turno</li>
    <li><b>1 a 4</b> (ou A a D): marcar a alternativa dita pela equipe</li>
    <li><b>M</b>: marcar a carta para discussão no fim · <b>Q</b>: mostrar o QR code da sala</li>
    <li><b>P</b>: pausar o tempo da pergunta · <b>R</b>: pausar o relógio da partida · <b>F</b>: tela cheia · <b>S</b>: som</li>
    <li><b>Z</b>: desfazer o turno · <b>H</b>: regras · <b>Esc</b>: fechar janelas</li>
  </ol>`;
}
function toggleFull(){
  try{
    if(document.fullscreenElement) document.exitFullscreen();
    else { const p = document.documentElement.requestFullscreen && document.documentElement.requestFullscreen(); if(p && p.catch) p.catch(() => toast('Tela cheia indisponível neste navegador. Use F11.')); }
  }catch(e){ toast('Tela cheia indisponível neste navegador. Use F11.'); }
}
function toggleSound(){
  ui.muted = !ui.muted;
  $('#m-sound').innerHTML = `Som: ${ui.muted ? 'desligado' : 'ligado'} <kbd>S</kbd>`;
  try{ localStorage.setItem(SAVE_KEY + '-mute', ui.muted ? '1' : '0'); }catch(e){}
}

document.addEventListener('keydown', e => {
  if(e.target.matches('input, textarea')) return;
  const k = e.key.toLowerCase();
  if(k === 'escape'){
    ['#confirm', '#gab', '#help'].forEach(s => $(s).hidden = true);
    if(state && state.phase === 'play' && !$('#lobby').hidden){ $('#lobby').hidden = true; }
    return;
  }
  if(!$('#confirm').hidden){ if(k === 'enter'){ e.preventDefault(); $('#confirm-ok').click(); } return; }
  if(!$('#lobby').hidden){ if(k === 'enter'){ e.preventDefault(); $('#btn-lobby-go').click(); } return; }
  if(!$('#mm').hidden){ if(k === ' ' || k === 'enter'){ e.preventDefault(); mmAvancar(); } return; }
  if($('#app').hidden || !$('#gab').hidden || !$('#help').hidden) return;
  if(k.length === 1 && /[a-z]/.test(k)){
    segredo = (segredo + k).slice(-7);
    if(segredo.endsWith('enron')){ segredo = ''; triturar(); return; }
    if(segredo === 'aezakmi'){ segredo = ''; sfx.bad(); telaGame('Cheat negado', 'continua procurado pela CVM · auditor não usa atalho'); return; }
    for(const cod of ['enron', 'aezakmi']) for(let L = Math.min(cod.length - 1, segredo.length); L >= 2; L--){ if(cod.startsWith(segredo.slice(-L))) return; }   // digitando um código: ignora atalhos
  }
  if(k === ' ' || k === 'enter'){ e.preventDefault(); primary(); return; }
  const idx = '1234'.indexOf(k) >= 0 ? '1234'.indexOf(k) : 'abcd'.indexOf(k);
  if(idx >= 0 && k.length === 1){ chooseAlt(idx); return; }
  if(k === 'm'){ if(ui.card && ui.card.done && ui.card.flag !== undefined){ ui.card.flag = !ui.card.flag; renderCard(); } return; }
  if(k === 'q'){ if(state && state.sala) showLobby(); return; }
  if(k === 'r'){ toggleRelogio(); return; }
  if(k === 'p') togglePause();
  else if(k === 'f') toggleFull();
  else if(k === 's') toggleSound();
  else if(k === 'z') undo();
  else if(k === 'h' || k === '?') openHelp();
});

window.addEventListener('resize', () => {
  if(!geom || $('#app').hidden) return;
  if(isVertical() !== geom.vertical) renderBoard();
});

/* Início */
Rede.init();
if(window.TRILHA_SEM_CELULAR) Rede.modo = 'off';
try{ ui.muted = localStorage.getItem(SAVE_KEY + '-mute') === '1'; }catch(e){}
$('#m-sound').innerHTML = `Som: ${ui.muted ? 'desligado' : 'ligado'} <kbd>S</kbd>`;
setDie(5);
buildSetup();
