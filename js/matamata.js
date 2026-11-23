/* ==================================================================
   Trilha de Auditoria · matamata.js
   Mata-mata do Auditor-Sócio: depois do pódio, os integrantes da equipe
   vencedora (ou das equipes empatadas em 1º) respondem pelo próprio
   celular, todos ao mesmo tempo. Quem erra ou não responde sai.
   - Se todos os que ainda estão no jogo errarem, ninguém sai.
   - Na final (2 pessoas) ou a partir de CONFIG.MM_VELOCIDADE_A_PARTIR,
     entre os que acertam vence o mais rápido.
   - Se houver empate em 1º entre equipes, a equipe do Auditor-Sócio
     fica com o 1º lugar.
   Licença MIT.
   ================================================================== */

let mmTimer = null;

function mmAbrir(){
  state.desempate = null;   // refazer o mata-mata refaz o desempate
  const order = ranking();
  const top = order.filter(o => sameRank(o, order[0])).map(o => o.i);
  const participantes = [];
  top.forEach(t => membros(t).forEach(m => participantes.push({ pid: m.pid, nome: m.nome, equipe: t, vivo: true, saiu: null })));
  state.mm = {
    ativo: true, equipes: top, rodada: 0, stage: 'pronto', participantes,
    q: null, respostas: {}, usadas: (state.mm && state.mm.usadas) || [], vencedor: null, msg: '', inicio: 0, left: 0
  };
  if(participantes.length === 1){
    state.mm.vencedor = { pid: participantes[0].pid, nome: participantes[0].nome, equipe: participantes[0].equipe };
    state.mm.stage = 'fim';
    state.mm.msg = 'Só um celular na equipe vencedora: vitória por W.O.';
    mmDesempate();
  }
  $('#end').hidden = true; $('#mm').hidden = false;
  mmRender(); sync();
}

function mmFechar(){
  clearInterval(mmTimer);
  if(state.mm) state.mm.ativo = false;
  $('#mm').hidden = true;
  endGame();
}

function mmNovaPergunta(){
  const mm = state.mm;
  let base = sorteiaSemRepetir('mm', MATAMATA, mm.usadas);
  if(!base){ mm.usadas = []; base = sorteiaSemRepetir('mm', MATAMATA, []); }
  mm.usadas.push(base.id); marcaHistorico('mm', base.id);
  const ordem = base.alternativas.map((_, i) => i).sort(() => Math.random() - 0.5);
  mm.q = { id: base.id + '-' + (mm.rodada + 1), pergunta: base.pergunta, alternativas: ordem.map(i => base.alternativas[i]), correta: ordem.indexOf(base.correta) };
  mm.rodada++; mm.respostas = {}; mm.naDisputa = mm.participantes.filter(x => x.vivo).length; mm.stage = 'pergunta'; mm.msg = '';
  mm.inicio = Date.now(); mm.left = CONFIG.MM_TEMPO;
  clearInterval(mmTimer);
  mmTimer = setInterval(() => {
    mm.left = Math.max(0, CONFIG.MM_TEMPO - Math.floor((Date.now() - mm.inicio) / 1000));
    if(mm.left <= 3 && mm.left > 0) sfx.tick();
    if(mm.left <= 0) mmRevelar(); else { mmRender(); sync(); }
  }, 1000);
  sfx.card(); mmRender(); sync();
}

/* Resposta vinda de um celular */
function mmResposta(m){
  const mm = state.mm;
  if(!mm || !mm.ativo || mm.stage !== 'pergunta' || !mm.q || m.q !== mm.q.id) return;
  const p = mm.participantes.find(x => x.pid === m.pid && x.vivo);
  if(!p || mm.respostas[p.pid]) return;
  const alt = Number(m.alt);
  if(!(alt >= 0 && alt < mm.q.alternativas.length)) return;
  mm.respostas[p.pid] = { alt, ms: Date.now() - mm.inicio };
  const vivos = mm.participantes.filter(x => x.vivo);
  if(vivos.every(x => mm.respostas[x.pid])) mmRevelar();
  else { mmRender(); sync(); }
}

function mmRevelar(){
  const mm = state.mm;
  if(mm.stage !== 'pergunta') return;
  clearInterval(mmTimer);
  mm.stage = 'revelado';
  const vivos = mm.participantes.filter(x => x.vivo);
  const certos = vivos.filter(x => mm.respostas[x.pid] && mm.respostas[x.pid].alt === mm.q.correta)
    .sort((a, b) => mm.respostas[a.pid].ms - mm.respostas[b.pid].ms);
  if(!certos.length){
    mm.msg = 'Ninguém acertou: ninguém sai. Próxima pergunta!';
    sfx.bad();
  } else {
    const porVelocidade = vivos.length === 2 || mm.rodada >= CONFIG.MM_VELOCIDADE_A_PARTIR;
    const ficam = porVelocidade ? [certos[0]] : certos;
    vivos.forEach(x => { if(!ficam.includes(x)){ x.vivo = false; x.saiu = mm.rodada; } });
    const sairam = vivos.filter(x => !x.vivo);
    if(ficam.length === 1){
      const w = ficam[0];
      mm.vencedor = { pid: w.pid, nome: w.nome, equipe: w.equipe };
      mm.msg = porVelocidade && certos.length > 1 ? `${w.nome} acertou mais rápido (${(mm.respostas[w.pid].ms / 1000).toFixed(1)} s).` : `${w.nome} foi o único a acertar.`;
      mmDesempate();
    } else {
      mm.msg = sairam.length ? `Saíram: ${sairam.map(x => x.nome).join(', ')}.` : 'Todos acertaram: ninguém sai.';
    }
    sairam.length ? sfx.bad() : sfx.ok();
  }
  mmRender(); sync(); save();
  if(mm.vencedor) setTimeout(() => { mm.stage = 'fim'; mmRender(); sync(); mmFesta(); }, 2200);
}

function mmDesempate(){
  const mm = state.mm;
  if(mm.equipes.length > 1 && mm.vencedor) state.desempate = mm.vencedor.equipe;
}

function mmAvancar(){
  const mm = state.mm; if(!mm) return;
  if(mm.stage === 'pronto' || mm.stage === 'revelado'){ if(!mm.vencedor) mmNovaPergunta(); }
  else if(mm.stage === 'pergunta') mmRevelar();
  else if(mm.stage === 'fim') mmFechar();
}

function mmFesta(){
  sfx.stamp(); setTimeout(sfx.ok, 300);
  for(let k = 0; k < 120; k++){
    const p = document.createElement('div');
    p.className = 'confetti';
    p.style.left = Math.random()*100 + 'vw';
    p.style.background = team(state.mm.vencedor.equipe).cor;
    p.style.animationDuration = (2.5 + Math.random()*2.5) + 's';
    p.style.animationDelay = (Math.random()*1.2) + 's';
    document.body.appendChild(p);
    setTimeout(() => p.remove(), 6500);
  }
}

/* O que os celulares recebem (nunca a resposta certa antes da revelação) */
function mmPublico(){
  const mm = state.mm;
  return {
    ativo: !!mm.ativo, rodada: mm.rodada, stage: mm.stage, id: mm.q ? mm.q.id : null,
    pergunta: mm.q ? mm.q.pergunta : null, alternativas: mm.q ? mm.q.alternativas : [],
    correta: mm.stage === 'pergunta' || !mm.q ? null : mm.q.correta,
    timer: mm.stage === 'pergunta' ? { left: mm.left, total: CONFIG.MM_TEMPO } : null,
    participantes: mm.participantes.map(p => ({ pid: p.pid, nome: p.nome, equipe: p.equipe, vivo: p.vivo, saiu: p.saiu, respondeu: !!mm.respostas[p.pid] })),
    vencedor: mm.vencedor, msg: mm.msg
  };
}

function mmRender(){
  const mm = state.mm; if(!mm) return;
  const vivos = mm.participantes.filter(p => p.vivo);
  const empate = mm.equipes.length > 1;
  let h = `<div class="mm-head"><div><div class="eyebrow">${empate ? 'Desempate do 1º lugar · ' : ''}Mata-mata</div><h1>Quem é o Auditor-Sócio?</h1></div>
    <div class="actions">${mm.stage === 'fim' ? '<button class="big main" id="mm-go">Voltar ao pódio</button>' : `<button class="big main" id="mm-go">${mm.stage === 'pergunta' ? 'Revelar agora' : mm.rodada ? 'Próxima pergunta' : 'Começar'} <kbd>Espaço</kbd></button>`}<button class="big ghost" id="mm-sair">Sair do mata-mata</button></div></div>`;

  if(!mm.participantes.length){
    h += `<div class="warn-box">Ninguém da equipe vencedora está com o celular na sala. Peça para entrarem pelo QR code (tecla Q no jogo) e abra o mata-mata de novo.</div>`;
  } else if(mm.stage === 'fim' && mm.vencedor){
    h += `<div class="mm-win">${chipHtml(mm.vencedor.equipe)}<div class="titulo">Auditor-Sócio da partida · dono do Trono de Ferro dos papéis de trabalho</div><div class="nome">${esc(mm.vencedor.nome)}</div><div class="mm-msg">${esc(state.groups[mm.vencedor.equipe].name)}</div>${empate ? `<div class="info-box">Empate no 1º lugar decidido: ${esc(state.groups[mm.vencedor.equipe].name)} fica em 1º.</div>` : ''}<div class="carimbo bate" style="position:static;transform:rotate(-8deg);color:#E0675B;border-color:#E0675B;margin-top:18px">AUDITADO</div></div>`;
  } else {
    if(mm.stage === 'pronto'){
      h += `<div class="info-box">Todos respondem ao mesmo tempo, cada um no seu celular, com ${CONFIG.MM_TEMPO} segundos por pergunta. Quem errar ou não responder sai. Se todos errarem, ninguém sai. Na final, ou a partir da ${CONFIG.MM_VELOCIDADE_A_PARTIR}ª pergunta, empate se decide pela velocidade.</div>`;
    } else if(mm.q){
      h += `<div class="mm-card"><div class="card-band" style="--cat:#7A2E27;background:#7A2E27"><div class="cat"><span class="cat-name">Pergunta ${mm.rodada}</span><span class="cat-meta">${mm.naDisputa} na disputa${mm.naDisputa === 2 || mm.rodada >= CONFIG.MM_VELOCIDADE_A_PARTIR ? ' · vale a velocidade' : ''}</span></div>${mm.stage === 'pergunta' ? `<div class="timer"><span class="t-num num ${mm.left <= 3 ? 'warn' : ''}">${mm.left}</span></div>` : ''}</div>
        <p class="q-text">${esc(mm.q.pergunta)}</p>
        <div class="mm-alts">${mm.q.alternativas.map((a, i) => `<div class="mm-alt ${mm.stage === 'pergunta' ? '' : (i === mm.q.correta ? 'right' : 'dim')}"><span class="lt">${LETRAS[i]}</span><span>${esc(a)}</span></div>`).join('')}</div></div>`;
      if(mm.stage !== 'pergunta' && mm.msg) h += `<div class="mm-msg">${esc(mm.msg)}</div>`;
    }
    h += `<div class="mm-players">${mm.participantes.map(p => {
      const r = mm.respostas[p.pid];
      const cls = !p.vivo ? 'out' : mm.stage !== 'pergunta' && r && r.alt === mm.q.correta ? 'ok' : r ? 'ans' : '';
      const info = !p.vivo ? `saiu na ${p.saiu}ª` : mm.stage === 'pergunta' ? (r ? 'respondeu' : '…') : r ? (r.alt === mm.q.correta ? (r.ms / 1000).toFixed(1) + ' s' : 'errou') : '';
      return `<div class="mm-p ${cls}">${chipHtml(p.equipe)}<span>${esc(p.nome)}</span><small>${info}</small></div>`;
    }).join('')}</div>`;
  }
  $('#mm-inner').innerHTML = h;
  const go = $('#mm-go'); if(go) go.onclick = mmAvancar;
  $('#mm-sair').onclick = mmFechar;
}
