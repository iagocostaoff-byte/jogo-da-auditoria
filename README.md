# Trilha de Auditoria

Jogo de tabuleiro para revisão de **Auditoria I, Auditoria II e Ética**, criado na FACC/UFRJ.
Proposta de atividade: Bernardo Furtado, Iago Costa e Thiago Primo.

- A **TV** (computador do professor) mostra o tabuleiro e o placar. O professor modera.
- Cada equipe é uma firma de auditoria fictícia (Kada Planilha Me Gasta, Erros & Yncertezas, De-Noite, Planilha WhatsApp & Café; Bateu Diferença Ontem e Grande Tormento com 5 ou 6 equipes).
- As equipes entram por **QR code**. O primeiro celular de cada equipe é o **capitão**: lança o dado e responde.
  Os outros celulares acompanham a pergunta e o placar.
- Sem internet, o jogo funciona **só na TV**: o professor marca as respostas ditas em voz alta.

## Arquivos

| Arquivo | Para que serve |
|---|---|
| `index.html` | Tela da TV (abra no computador ligado à TV) |
| `jogador.html` | Tela dos celulares (aberta pelo QR code) |
| `js/conteudo.js` | **Perguntas, casos reais, piadas, regras e pontuação. É o arquivo para editar.** |
| `js/firebase-config.js` | Configuração do Firebase (opcional) |
| `js/tv.js`, `js/rede.js`, `js/matamata.js` | Lógica do jogo, da conexão e do mata-mata |
| `js/vendor/` | Cliente MQTT, Firebase SDK e gerador de QR code (bibliotecas de código aberto) |

## Como os celulares se conectam

Sem configurar nada, o jogo usa um **servidor público e gratuito de mensagens** (MQTT via WebSocket:
EMQX, HiveMQ ou Mosquitto, nessa ordem). A TV usa o primeiro que responder e o QR code leva os celulares
para o mesmo servidor. Funciona com celulares em qualquer rede (Wi-Fi ou 4G).

Esses servidores são públicos e sem garantia de funcionamento: teste antes da aula. Algumas redes de
universidade bloqueiam as portas usadas (8084, 8884, 8081); nesse caso, use o 4G ou outra rede.

### Opcional: Firebase

Para uma conexão com mais garantia, dá para usar o Firebase Realtime Database (gratuito):

1. Em <https://console.firebase.google.com>, crie um projeto e, em **Criação › Realtime Database**, um banco no modo bloqueado.
2. Na aba **Regras** do banco, cole o conteúdo de `database.rules.json` e clique em **Publicar**.
3. Em **Visão geral › Web (`</>`)**, registre um app e cole o `firebaseConfig` em `js/firebase-config.js`, no lugar de `null`
   (confira se tem a linha `databaseURL`).
4. Publique de novo. Com o Firebase configurado, o jogo passa a usá-lo no lugar do servidor público.

## Publicar

O jogo é só um conjunto de arquivos estáticos: funciona no GitHub Pages, Netlify, Firebase Hosting ou
qualquer hospedagem de site. No GitHub Pages: **Settings › Pages › Deploy from a branch › main / (root)**.

## Em sala

1. No computador ligado à TV, abra o endereço publicado no Chrome ou Edge e aperte **F** para tela cheia.
   Na tela da sala deve aparecer "Conectado ao servidor".
2. Escolha **Pelo celular**, o número de equipes, a duração e o tempo, e clique em **Criar sala**.
3. Os alunos apontam a câmera para o QR code, digitam o nome e escolhem a equipe.
   Toque num nome na tela da sala para trocar o capitão.
   O capitão escolhe no celular a **imagem do pino**: um dos emojis ou uma foto da galeria (reduzida
   para poucos KB). Ela anda no tabuleiro no lugar da sigla, com um anel na cor da equipe. Para tirar uma
   imagem imprópria, clique em **remover** ao lado dela nesta tela (durante a partida, tecla **Q**).
4. Clique em **Começar partida**. Quem chegar atrasado entra pelo QR code no canto da tela (tecla **Q**).

### Mata-mata: Auditor-Sócio (uns 5 minutos)

Ao criar a sala, escolha **Com mata-mata** ou **Sem mata-mata** (só aparece no modo pelo celular).
Com mata-mata, no Parecer final clique em **Mata-mata: Auditor-Sócio**. Entram todos os integrantes da equipe
vencedora que estão com o celular na sala; se duas ou mais equipes empataram em 1º, entram todas
elas, e a equipe de quem vencer fica com o 1º lugar.

- Uma pergunta rápida por vez, com 12 segundos, todos respondem ao mesmo tempo no celular.
- Quem erra ou não responde sai. Se todos errarem, ninguém sai.
- Com 2 pessoas, ou a partir da 6ª pergunta, entre quem acerta vence o mais rápido.
- Espaço avança (começar, revelar antes do tempo, próxima pergunta). As perguntas são de um banco
  próprio (`[EDITAR-MATAMATA]`), diferente das cartas do jogo.

### Atalhos do moderador

| Tecla | Ação |
|---|---|
| Espaço / Enter | Lançar o dado, próximo turno |
| 1 a 4 | Marcar a alternativa dita (equipe sem celular) |
| M | Marcar a carta para discussão no fim |
| Q | Mostrar o QR code da sala |
| P | Pausar o tempo |
| Z | Desfazer o turno |
| F | Tela cheia |

### Testar sem internet

Rode um servidor local nesta pasta (por exemplo, `python3 -m http.server`) e abra
`http://localhost:8000/?modo=local`: o link da sala aberto em outras abas do mesmo navegador simula os celulares.

## Surpresas (não conte para a turma)

| Surpresa | Como acontece |
|---|---|
| Auditoria surpresa da CVM | Dois 6 seguidos no dado: verdadeiro ou falso só para essa equipe, valendo o dobro |
| Fechamento do exercício | Quem para na casa 31 (31/12) ganha +10 por fechar o balanço no prazo |
| Carimbo AUDITADO | Acerto em pergunta difícil, caso prático, caso real ou surpresa da CVM |
| Sem ressalvas | 3 acertos seguidos dão o título no placar, até o primeiro erro |
| Fragmentadora | Digite ENRON no teclado da TV: a carta (ou o tabuleiro) é triturada |
| RESSALVADO | Na primeira resposta errada de cada carta, o letreiro aparece por cima da tela em preto e branco, no estilo de videogame |
| Parecer emitido | Volta completa no tabuleiro mostra o letreiro dourado de missão cumprida |
| Nível de risco | Os casos reais mostram de 1 a 5 estrelas de risco, como o nível de procurado (Enron, WorldCom, Wirecard e Americanas têm 5) |
| Cheat negado | Digite AEZAKMI no teclado da TV (o código de "nunca procurado"): o jogo recusa |
| Vergonha! | Às vezes, ao errar pergunta fácil, a piada vira "Vergonha! Vergonha! Vergonha!" com sino |
| Lannister | Piada de acerto e carta de revés: "Um Lannister sempre paga suas dívidas" (a circularização discorda) |
| Casamento Vermelho | Carta de revés: aceitar convite para o casamento do diretor financeiro do cliente |
| O fechamento está chegando | Aviso quando faltam 5 minutos de jogo |
| Trono de Ferro | O Auditor-Sócio do mata-mata vira dono do Trono de Ferro dos papéis de trabalho |
| Friends | Cartas "Pivô! Pivô! Pivô!" (revés) e "Café no Central Perk" (perde a vez); piadas "Como você está?", "poderia SER mais relevante?" e "a gente estava dando um tempo" |
| A Grande Família | Cartas "O Lineu revisou" e "Esquema do Agostinho" (sorte) e "Pastel no Beiçola" (perde a vez); piadas do Lineu e do Agostinho |
| Prêmios do parecer | No pódio: Cynthia Cooper, Ladrão de Evidências, Fragmentadora de Ouro, Repo 105, Parecer emitido e Abstenção de opinião (quem terminou com zero) |

As regras e pontos das surpresas ficam em `[EDITAR-CONFIG]` (`CASA_FECHAMENTO`, `SEQUENCIA_SEM_RESSALVAS`, `PONTOS.cvm`, `PONTOS.fechamento`).

## Como editar perguntas e regras

Tudo fica em `js/conteudo.js`. Procure as marcações:

| Marcação | O que muda |
|---|---|
| `[EDITAR-CONFIG]` | pontos, tempos, rodadas, texto da nota |
| `[EDITAR-EQUIPES]` | firmas, cores e siglas das equipes |
| `[EDITAR-TRILHA]` | ordem das 36 casas |
| `[EDITAR-AUDITORIA]` | perguntas de Auditoria I |
| `[EDITAR-AUDITORIA2]` | perguntas de Auditoria II (ativo não circulante) |
| `[EDITAR-ETICA]` | perguntas de Ética |
| `[EDITAR-CASOS]` | casos práticos fictícios |
| `[EDITAR-REAIS]` | casos reais, com contexto, piada e fonte |
| `[EDITAR-DILEMAS]` | dilemas éticos de resposta aberta |
| `[EDITAR-RELAMPAGO]` | verdadeiro ou falso para todas as equipes |
| `[EDITAR-EVENTOS]` | sorte ou revés e perde a vez |
| `[EDITAR-PIADAS]` | frases de acerto e de erro |
| `[EDITAR-MATAMATA]` | perguntas rápidas do mata-mata do Auditor-Sócio |

Nas perguntas, `correta` é a posição da resposta certa começando em 0. As alternativas são
embaralhadas a cada partida. Depois de editar, publique de novo (no GitHub, basta enviar o arquivo alterado).

Ao publicar uma mudança no código, aumente `VERSAO` em `js/rede.js` e o `?v=` dos scripts em `index.html` e
`jogador.html`. Se a TV ficar com a página antiga em cache, os celulares avisam "Versões diferentes":
recarregue a TV com Ctrl+Shift+R.

## Avisos

- Os celulares nunca recebem a resposta certa antes da revelação. Mas `js/conteudo.js` é público no site:
  um aluno curioso pode abrir o arquivo. Se isso preocupar, não divulgue o endereço do site, só o QR code.
- Quem souber o código da sala pode ler o que passa por ela (placar, nomes digitados). Para uma atividade
  de sala de aula isso basta; peça só o primeiro nome e não guarde dados pessoais no jogo.
- Os casos reais citam fontes públicas. Confira se há novidades antes de usar: alguns processos ainda estão em andamento.
- As equipes são firmas fictícias. Os casos reais citam as firmas verdadeiras apenas como fato histórico, com fonte; o jogo não tem relação com essas empresas.

## Letreiros

`img/ressalvado.png`, `img/parecer-emitido.png` e `img/cheat-negado.png` são imagens prontas feitas com a fonte
Pricedown (Ray Larabie, Typodermic). A licença gratuita da fonte permite arte fixa, mas não permite colocar o
arquivo da fonte no site; por isso o arquivo da fonte não está neste repositório.

## Licença

MIT (veja `LICENSE`). Bibliotecas incluídas: MQTT.js (MIT), Firebase SDK (Apache 2.0, Google) e
qrcode-generator (MIT, Kazuhiko Arase).
