# JN-Confeccoes
sistema JN confeccoes

## Firebase e login local

O JN publicado em `https://robson10sjp-blip.github.io/JN-Confeccoes/` usa o projeto
Firebase `jn-confeccoes`. A publicacao confirmada e GitHub Pages, branch `gh-pages`.
O arquivo `.env.example` e apenas um modelo: Vite nao o carrega como configuracao.

Para recuperar a mesma configuracao web publica do site JN, sem expor valores:

```sh
node scripts/restore-jn-firebase-env.mjs --check
node scripts/restore-jn-firebase-env.mjs --write
npm run dev -- --host 0.0.0.0
```

O comando `--write` gera somente `.env` local, ignorado pelo Git, com permissoes
restritas. Nao sobrescreve arquivo existente, nao executa JavaScript remoto e
exige projeto e dominio JN exatos. Nao cria projeto, usuario ou dados Firebase.
O script utiliza o parser do Rollup instalado pelo Vite. Nunca enviar `.env` ao Git.

Alternativa manual: no Firebase Console, selecionar `jn-confeccoes`, abrir
Configuracoes do projeto > Geral > Seus aplicativos > aplicativo web > Configuracao
do SDK. Preencher localmente as variaveis de `.env.example` em `.env`, sem compartilhar
seus valores. Reiniciar o Vite depois da alteracao.

Obrigatorias: `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN` e
`VITE_FIREBASE_PROJECT_ID`. Storage, messaging sender, app ID e measurement ID nao
bloqueiam o login por e-mail/senha. Erros reais de inicializacao sao preservados;
um app ja inicializado com projeto diferente e recusado.

Para conferir o painel do mesmo projeto:

1. Abrir Authentication > Sign-in method (Metodo de login) > E-mail/senha e conferir se esta habilitado.
2. Abrir Authentication > Settings > Authorized domains. A consulta publica encontrou `localhost`, mas nao `robson10sjp-blip.github.io`; conferir e adicionar o dominio do site JN se necessario para fluxos de redirecionamento/links.
3. E-mail/senha nao e informado pela consulta publica de metadados. Sem sessao autorizada no painel e sem credenciais de usuario, nao ha confirmacao de login real.

Se houver outra hospedagem JN no Netlify, confirmar primeiro a URL e o site corretos:
Site configuration > Environment variables, preencher as mesmas variaveis no contexto
do build JN e gerar um novo deploy autorizado. Variaveis `VITE_*` sao incorporadas
no build; alterar apenas o painel nao atualiza um pacote ja publicado. Nao foi
confirmado site Netlify associado a este repositorio e nenhum deploy foi realizado.

Teste de autenticacao isolado, com Vite ativo e ambiente JN configurado:

```sh
node scripts/test-auth-config.mjs
```

O teste usa entradas ficticias e intercepta as respostas de Authentication. Nenhum
login, cadastro ou acesso ao banco real e realizado durante ele. O teste de
configuracao tambem cobre variaveis ausentes, campos opcionais e projeto divergente.

## Fontes dos dados

### Preparar sistema para recomecar

**Modo atual da tela: limpeza completa das movimentacoes.** Esta autorizacao e
distinta do encerramento administrativo anterior. O servico mantem o modo antigo
para compatibilidade, mas o botao do painel prepara agora `mode: cleanup`.

1. Entrar no JN e clicar em **Preparar sistema para recomecar**.
2. Guardar o download `jn-antes-da-limpeza-completa-<id>.json` fora do Git.
3. Conferir vendas, contas, recebimentos, recibos/pagamentos auxiliares a excluir,
	devolucoes comprovadas (antes/quantidade/depois) e itens sem identificacao segura.
4. Localizar a copia e clicar em **Confirmar limpeza completa**, ou **Cancelar**.
5. Conferir o resultado: historicos vazios, cadastros preservados e estoque de cada
	devolucao. Guardar tambem **Baixar resultado** junto da copia original.

O modo completo apaga somente documentos das colecoes `sales`, `financeiroReceber`,
`financeiroRecebimentos`, `receipts` e `payments` capturados na copia do mesmo UID.
Clientes e produtos nao sao apagados/recriados. Nos produtos, apenas a devolucao
comprovada pode mudar stockQuantity/stockMovementId; precos, codigos e demais campos
ficam iguais. Apagar o historico de recebimentos e as vendas remove a base dos
valores antigos recebidos, em vez de mascarar os valores na tela.

O marcador `systemMovementCleanup` no usuario e separado de `systemRestart`, de modo
que o encerramento anterior nao impede a limpeza nova. A lista de devolucoes do
resultado anterior e `stockReturn.completed` impedem devolver novamente. Vendas
encerradas sem devolucao ainda sao examinadas, mas so evidencias atuais confiaveis
permitem incremento; ausencia de venda/itens/prova exige ajuste manual posterior.

A exclusao, devolucao e marcador sao gravados em uma unica transacao. Mesmo envio
ou nova abertura depois de concluida nao apagam movimentacoes novas nem repetem
devolucao. A verificacao final compara clientes e todos os campos dos produtos e
confere que todas as colecoes de movimentacao estejam vazias. Novas operacoes
concorrentes podem exigir conferencia; nao use outras abas durante a limpeza.
O limite seguro permanece 400 documentos afetados. Acima disso, a operacao e
recusada sem gravar e exige execucao assistida em servidor, nao regras abertas.

Para recuperar apos a limpeza, usar a copia original em restauracao assistida,
no mesmo projeto/UID: recriar apenas os documentos de movimentacao apagados em seus
IDs originais, reverter exclusivamente o estoque comprovadamente alterado e tratar
os marcadores administrativos sem sobrescrever dados posteriores. Nao importar o
JSON tipado diretamente no Console, nem apagar clientes/produtos para restaurar.

As regras versionadas ja permitem `read, write` nessas colecoes para o proprio
usuario, incluindo delete. Nenhuma regra/configuracao foi alterada e nenhuma
limpeza real foi executada durante os testes. O modo completo foi testado com
R$ 330 ficticios e apos encerramento anterior, incluindo falha antes do commit,
repeticao e indicadores zerados. Para o site publicado, esta versao precisa de
publicacao posterior, nao executada aqui.

#### Modo anterior: encerramento com historico

Opcao temporaria no topo de todas as paginas do painel autenticado. Ela opera
somente em `jn-confeccoes` e no UID conectado, usando as permissoes existentes.
Nao foi executada nos registros reais durante o desenvolvimento.

1. Entrar no JN com o usuario dono dos registros.
2. Clicar em **Preparar sistema para recomecar**. A leitura vem do servidor e o
	navegador solicita o download de `jn-antes-do-reinicio-<identificador>.json`.
3. Guardar a copia fora do Git, em local seguro: ela contem dados pessoais,
	caminhos/IDs, valores originais tipados, documento do usuario e plano.
4. Conferir contas a encerrar, produtos/quantidades/estoque antes/depois e pendencias.
	Marcar que localizou a copia e clicar em **Confirmar reinicio**, ou **Cancelar**.
5. Ao concluir, conferir o resultado e usar **Baixar resultado** para guardar o resumo.

O encerramento adiciona `restartClosure` com o motivo **Encerrada para reinicio**;
nao altera amount/receivedAmount, pagamentos, datas financeiras ou precos.
Contas e vendas antigas ficam consultaveis pelo filtro de encerradas; saldos
atuais sao zero e os indicadores atuais desconsideram essas dividas. Clientes,
produtos e todos os pagamentos sao preservados, sem documentos recriados.

Devolucao automatica exige `stockDebitProof` versionado da venda, quantidades
numericas inteiras, IDs existentes, estoque antes/depois e `stockMovementId`
atual no produto, sem devolucao anterior. Novas vendas passam a registrar essa
evidencia na mesma transacao da baixa. Vendas antigas sem prova nao recebem
evidencia retroativa: ficam na lista de conferencia, sem incremento de estoque.
Mudanca manual/edicao de quantidade invalida a evidencia anterior. Se houver
mais de uma baixa historica nao comprovada no mesmo produto, nao ha inferencia
de cadeia nem soma por suposicao.

A execucao e uma unica transacao com marcador persistente `systemRestart` no
documento `users/{uid}`, ja permitido pelas regras. Repetir a confirmacao ou
abrir a opcao apos conclusao nao devolve novamente. Falha de commit nao deixa
reinicio parcial. Alteracoes detectadas apos o backup exigem nova conferencia.
O plano considera apenas os registros capturados; evite operacoes em outras abas
durante o reinicio. Mudancas concorrentes novas podem fazer a verificacao final
pedir conferencia, sem autorizar uma nova devolucao automatica.

Limite conservador: ate 400 documentos afetados e relatorio ate 500 KB. Volumes
maiores sao recusados sem gravacao e exigem execucao assistida em servidor,
nao liberacao de regras. Permissoes reais mais restritas tambem interrompem a operacao.

**Recuperacao:** guardar o JSON original e o resultado. O formato tipado preserva
timestamps, valores especiais e IDs (`packRestartValue`/`unpackRestartValue`).
Ele nao e um arquivo para importar diretamente no Console Firebase. A restauracao
deve ser assistida no mesmo projeto/UID, comparar as mudancas posteriores e
restaurar apenas os campos afetados nos mesmos IDs (marcas administrativas,
stockQuantity/stockMovementId e metadados do usuario). Nao sobrescrever clientes,
pagamentos ou produtos inteiros nem apagar registros novos para desfazer o reinicio.
Nao foi incluido botao de restauracao automatica por esse risco.

Testes isolados: `node scripts/test-system-restart.mjs` e o teste de navegador
`scripts/test-query-pages.mjs`. Cobrem copia tipada, permissao/UID, cancelamento,
falha antes do commit, dados alterados, segunda execucao, devolucao comprovada,
pendencias e saldos zero nos modulos. Nao ha alteracao de Firebase/Netlify ou deploy;
para aparecer no site publicado, esta versao precisara ser publicada posteriormente.

### Apresentacao dos cadastros existentes

Produtos e clientes existentes continuam disponiveis para consulta e edicao, sem
exportacao ou recadastro como condicao de uso. A apresentacao reduz espacos repetidos;
descricoes padronizam somente palavras comuns reconhecidas, preservando textos
desconhecidos, marcas, codigos, acentos e caracteristicas. Nomes proprios mantem a
caixa quando houver duvida. Formulario e atualizacoes parciais usam os valores
originais: nao ha limpeza em lote nem gravacao automatica no banco.

Financeiro identifica que as contas antigas mostram a situacao registrada no sistema,
nao uma cobranca novamente confirmada: o proprietario informou que ja foram pagas e
fara sua revisao. O aviso Recebido agora exibe junto ao resumo os motivos concretos
calculados na sessao (sem historico identificavel, valor invalido, divergencia entre
historicos ou data ausente no periodo). Subtotal conhecido nao e apresentado como
quitacao completa. Nenhum saldo ou pagamento e criado para retirar o aviso.

Sem sessao autenticada acessivel, estas melhorias de tela podem ser feitas e testadas
com dados isolados, sem bloquear o trabalho por exportacao manual. Alterar registros
reais exigiria acesso autorizado ao usuario correto; nao compartilhar credenciais.

### Financeiro

- Contas ficam em `users/{uid}/financeiroReceber`; lancamentos em `financeiroRecebimentos`; vendas em `sales`. O codigo atual de Vendas cria parcelas com `saleId`, mas contas antigas podem ter outro formato ou apontar para venda ausente. Nao ha auditoria de origem suficiente para provar cadastro direto, importacao ou exclusao de venda apenas por esses campos.
- Os numeros informados pelo usuario (28 contas, 25 em aberto, 28 sem venda localizada) nao foram confirmados por leitura autenticada nesta etapa. Diagnostico calcula as contagens a partir da sessao do proprio usuario; nenhum registro foi migrado, quitado ou associado por nome.
- Quatro indicadores: saldo atual de todas as contas, pagamentos registrados por data de pagamento, saldo vencido e clientes distintos por ID. Filtros de vencimento/busca/situacao restringem a lista, nao os saldos gerais. Periodo dos recebimentos tem controle separado.
- Campos monetarios ausentes, negativos, com precisao invalida ou saldo contraditorio nao viram zero. Pagamentos sem data nao permitem confirmar um periodo restrito; valores pagos salvos sem historico identificavel pedem conferencia. O subtotal conhecido e identificado como tal.
- Ficha mostra valor original, pago, saldo, datas e pagamentos por `receivableId`. Ausencia de venda aparece discretamente nela. IDs confiaveis permitem relacionamento com o cliente; falta de ID nao e resolvida por nomes parecidos. Historicos somente por `saleId` nao sao repartidos entre parcelas sem prova.
- Recebimento exige conferir valor/data/forma e confirmar. Conta, venda existente e lancamento sao atualizados numa transacao com requestId idempotente. A conta escolhida recebe o valor, sem transferi-lo para outra parcela; sem venda localizada, atualiza somente a conta e seu lancamento, sem fabricar venda. Vendas/parcelas divergentes bloqueiam recebimento.
- Contas quitadas nao oferecem Receber. PDF continua sendo relatorio, nao comprovante de pagamento; inclui todos os resultados filtrados. Venda localizada abre os detalhes existentes em Vendas para acesso ao recibo.
- Para revisar as contas antigas, obter leitura autorizada ou exportacao do mesmo UID: contas, historico, vendas e clientes. Comparar IDs, valores acumulados e comprovantes; separar sem venda, sem cliente, sem historico e status divergente. Somente depois autorizar uma regularizacao explicita ou arquivamento. Nao registrar quitacao retroativa ficticia.
- Regras versionadas ja permitem as leituras e transacoes do proprio UID; nao foram alteradas. Nenhum deploy, configuracao Firebase/Netlify ou pagamento real foi executado nos testes.

Testes seguros: `node scripts/test-financial-records.mjs` e `scripts/test-query-pages.mjs`
(SDK/banco simulados, parcial/total, conta sem venda, conta especifica, repeticao,
erro/retry, filtros, historico, PDF, recibo e notebook/celular).

### Vendas

- A aba le `users/{uid}/sales`; contas antigas ficam em `financeiroReceber` e pagamentos em `financeiroRecebimentos`. Ter clientes/contas nao prova que ha documentos de venda. Nada transforma contas em vendas ou relaciona nomes parecidos automaticamente.
- Leitura inclui vendas sem `saleDate`, com ordenacao local. Estado vazio, filtro sem resultado, erro e cache nao confirmado sao distintos. Diagnostico mostra registros sem venda localizada e valores/datas a conferir. Nenhuma quantidade real foi confirmada sem sessao autorizada.
- Busca inclui nome/apelido por `clientId`. Periodo padrao Todo o periodo; indicadores de quantidade/vendido/saldo seguem a data das vendas exibidas. Recebido segue `paymentDate` e pode vir de vendas anteriores; filtros de cliente/situacao/vencimento restringem seus vinculos. Historico da propria venda prevalece sobre espelhos financeiros, sem somar acumulados de novo.
- Nova venda oferece busca de cliente/produto, itens, preco registrado, quantidade, desconto, a vista/a prazo, parcelas mensais ja existentes e entrada opcional explicita. A conferência antecede a confirmacao. Datas de parcelas mantem o calendario local e ajustam o dia ao ultimo dia do mes quando necessario.
- Criacao usa identificador por envio e agrega quantidades do mesmo produto, baixando uma vez por produto em transacao. Novas vendas com pagamento inicial o registram no historico da propria venda. Isso nao adiciona pagamentos a vendas antigas.
- Edicao nao consulta queries dentro da transacao, nao le depois de escrever, nao recria parcelas nem pagamentos. Itens/data identicos ficam intactos; mudar preco atual do produto nao muda preco historico. Diferencas de quantidade usam apenas o delta de estoque. Mudancas em condicoes financeiras ou totais vinculados ficam bloqueadas para revisao especifica.
- Recebimento atualiza venda e parcelas na mesma transacao, com identificador idempotente por envio da tela. Valores divergentes ou saldo insuficiente bloqueiam a operacao. Chamadas do Financeiro continuam usando a mesma assinatura, sem novo lancamento financeiro criado automaticamente por este servico.
- **Excluir venda** esta na lista e nos detalhes. A confirmacao mostra cliente, data, valor, vinculos e estoque antes/quantidade/depois. A operacao retira a venda da movimentacao atual e adiciona `saleCancellation` na venda e nas contas/pagamentos/recibos vinculados por IDs exatos; originais ficam consultaveis em **Excluidas (historico)**. Nao apaga pagamentos, nao altera seus valores/datas nem simula estorno de dinheiro. Os lancamentos cancelados ficam fora dos totais atuais recebidos e a divida atual e zero, sem rotular a conta como paga.
- Devolucao exige prova de baixa ainda valida para todos os produtos da venda (`stockDebitProof` e `stockMovementId`), sem `stockReturn.completed` nem devolucao anterior registrada no usuario. Venda antiga sem prova fica em conferencia; nenhuma quantidade e adivinhada. Cancelamento/vinculos/devolucao usam uma unica transacao; repeticao reconhece o marcador e nao incrementa estoque novamente. Mudancas na venda, vinculos, estoque ou estado do reinicio exigem reabrir a confirmacao. Limite de 400 documentos afetados, sem gravacao parcial.
- Transacoes de editar/receber recusam registros cancelados. A leitura de vinculos antecede a transacao e os documentos capturados sao reconferidos nela; pagamentos concorrentes pelos servicos atuais disputam os mesmos documentos e sao rejeitados ou exigem nova conferencia. Escritas externas, clientes antigos ou alteracoes manuais fora desses servicos nao tem garantia global de ausencia de novos vinculos; evite outras abas durante a exclusao. Nao foram abertas regras nem instalado backend novo.
- Recibo abre dentro da mesma tela, com **Voltar** e **Imprimir recibo** fora do documento. Voltar preserva ficha, pesquisa e filtros, sem depender de pop-up ou `window.close()` no iPhone. Impressao/PDF usam somente o documento no iframe, sem controles; no celular, os campos da tabela ficam empilhados apenas na tela, mantendo o modelo de impressao. Regras/configuracoes Firebase e publicacao nao foram alteradas nesta tarefa; estas mudancas precisam de nova publicacao autorizada para aparecer no site.
- Recuperacao de dados reais exige uma sessao autorizada ou exportacao somente leitura do mesmo UID (sales, financeiroReceber, financeiroRecebimentos, clients e IDs de produtos). Conferir IDs exatos e backup; contas sem itens/data de venda confiavel nao podem ser reconstruidas como vendas apenas por nome ou valor.

Teste focado seguro: `node scripts/test-sale-deletion.mjs` (SDK inteiramente
simulado; falha antes do commit, repeticao, venda parcialmente/totalmente paga,
concorrencia, vinculos exatos, estoque antigo sem prova e devolucao anterior).
Com Vite local ativo, `JN_SALE_DELETION_ONLY=1 node scripts/test-query-pages.mjs`
confere lista/ficha, confirmacao, clique duplo, saldo e recibo em 1366/390/320 px,
sem rede externa ou banco real. `JN_TEST_BROWSER=webkit` seleciona WebKit quando
o navegador e suas bibliotecas estiverem disponiveis. Safari/iPhone fisico ainda
exige validacao no aparelho; WebKit nao executou neste conteiner por dependencias
de sistema ausentes. Nenhuma exclusao ou reinicio real foi executado nestes testes.

Testes seguros: `node scripts/test-sales-records.mjs` e o teste de navegador
`scripts/test-query-pages.mjs`. SDK/banco sao simulados, incluindo entradas,
recebimentos, erro, retry, estoque, edicao, recibo e telas de notebook/celular.

### Produtos

- Valor do estoque para venda e a soma de quantidade disponivel multiplicada pelo preco unitario de venda. Resumo geral independe dos filtros; subtotal dos produtos encontrados aparece separado. Produtos sem estoque nao contribuem para a estimativa.
- Custos usam `costPrice`, campo ja existente e opcional. Ausente, vazio, negativo ou invalido nao vira zero: a tela informa a quantidade de produtos a revisar e nao apresenta lucro bruto total como completo. Zero explicitamente cadastrado e diferente de custo vazio. Lucro bruto estimado nao desconta despesas ou impostos e nao e dinheiro recebido.
- Quantidades/precos invalidos deixam a estimativa incompleta, com contagens de revisao e subtotal conhecido identificado. Calculos monetarios usam centavos inteiros e recusam valores fora do limite seguro ou com precisao de preco nao confirmada. Nenhum dado antigo e ajustado para permitir o calculo.
- Ficha e cartoes no celular mostram quantidade, preco unitario e valor total para venda. A ficha acompanha as atualizacoes de leitura, sem mudar o formulario de edicao ou o estoque salvo.
- Resumo atual: quantidade de documentos de produto, soma de `stockQuantity` validos (unidades inteiras nao negativas), e produtos com estoque zero. A regra de totalizacao e a mesma do Dashboard; valores invalidos pedem conferencia, nao viram zero.
- Clientes/Dashboard nao foram redesenhados nesta etapa. As leituras de produtos passaram a incluir documentos sem `createdAt`, antes excluidos pelo `orderBy` do Firestore; o ID verdadeiro do documento prevalece sobre campos internos.
- Pesquisa por descricao, nome ou codigo sem exigir acentos; categoria pelos valores existentes; estoque Todos/Em estoque/Sem estoque; lista alfabetica e paginacao de 20 produtos.
- Categoria e texto livre com sugestoes existentes. Tamanho/cor/categoria nao sao obrigatorios para utensilios. Campos antigos inalterados nao sao regravados; tamanhos compostos e quantidade total sao preservados.
- Novos/alterados valores e quantidades sao validados. Quantidade deve ser inteira e nao negativa; precos aceitam formato brasileiro. Codigo repetido exige revisao/confirmacao, sem juntar produtos.
- Edicao envia somente campos modificados. Se o usuario alterar estoque, uma transacao compara a quantidade atual com a quantidade ao abrir o formulario; mudancas concorrentes abortam o salvamento em vez de sobrescrever uma venda.
- Exclusao exige confirmacao e releitura de vendas no servidor. IDs atuais e formatos legados `item.id`/`item.product.id` sao conferidos; nomes nao criam vinculos. Vendas ou itens sem ID confiavel bloqueiam a exclusao. Garantia atomica contra uma venda criada entre essa leitura e a exclusao exigiria backend/regras especificas, nao alterados aqui.
- Nao existe controle de quantidade por tamanho/cor no modelo atual: cada produto tem apenas `stockQuantity`. Uma futura grade de variacoes exige planejar tambem as vendas, sem repartir quantidades antigas automaticamente.
- Nao foi encontrado limite cadastrado confiavel de estoque baixo. O Dashboard aprovado conserva seu criterio visual anterior de 1 a 5; Produtos nao inventa nem grava um limite novo e nao oferece filtro de estoque baixo.
- As regras versionadas ja permitem leitura/edicao de produtos e vendas do proprio usuario; nenhuma regra, configuracao Firebase ou publicacao foi alterada nesta etapa.

Teste especifico: `node scripts/test-product-records.mjs` (SDK inteiramente simulado,
incluindo baixa de estoque na criacao de venda e recusa de estoque insuficiente).
O teste existente de navegador cobre filtros, ficha, CRUD ficticio, conflito de
estoque, exclusao, erros, vazios, carregamento e capturas de notebook/celular.
Sem sessao autorizada nao ha recontagem dos registros reais do usuario.

### Clientes

- Lista alfabetica com pesquisa por nome, apelido ou telefone, sem exigir acentos. Filtro pelas cidades existentes e paginacao de 20 registros; ficha e retorno preservam a consulta.
- Somente o nome e obrigatorio. Telefone novo/alterado aceita DDD e numero brasileiro (10 ou 11 digitos) ou vazio. CPF e opcional, conferido por formato, nao por autenticidade.
- O principal continua em `phone`, compativel com Financeiro e recibos. Outro contato opcional usa `secondaryPhone` e `secondaryPhoneLabel`; o formulario permite adicionar/remover e a busca considera ambos os numeros. A identificacao do outro contato e opcional. Textos antigos com varios numeros/identificacoes nao sao separados automaticamente; a edicao mostra o conteudo original ate salvar a organizacao manual.
- As regras versionadas de clientes autorizam campos do proprio UID sem lista fixa de nomes; esses campos opcionais nao exigem alteracao de regras. Nenhum painel ou configuracao Firebase e modificado pelo ajuste.
- O formulario antigo aceitava texto livre no telefone e o salvava diretamente. Isso permite letras, mas nao comprova como cada registro real foi inserido. Nao ha limpeza automatica; telefones antigos invalidos continuam visiveis com aviso e nao sao incluidos no update quando inalterados.
- Novos cadastros avisam sobre CPF igual ou nome+telefone iguais. A confirmacao permite homonimos; a verificacao nao e uma restricao unica no banco.
- A ficha consulta vendas, contas, recebimentos, recibos e pagamentos conhecidos do mesmo UID, sempre por IDs. Contas da mesma venda nao sao somadas novamente ao saldo. Valores contraditorios ficam sem saldo confirmado; nomes semelhantes nao criam vinculos.
- Exclusao exige confirmacao e nova leitura do servidor. Vendas, contas, pagamentos, recibos relacionados ou registros antigos sem dono confiavel bloqueiam a operacao. Sem conexao/leitura autorizada, nao ha exclusao.
- Essa protecao e do aplicativo/servico. Uma garantia atomica contra uma venda criada simultaneamente entre a consulta e a exclusao dependeria de operacao backend e regras especificas; elas nao foram alteradas nesta etapa.

Teste de regras/servico sem Firebase: `node scripts/test-client-records.mjs`.
O teste existente de navegador simula cadastro, edicao, duplicidade e exclusao
somente em objetos locais. Nenhum CRUD real e executado nos testes.

### Visao geral (Dashboard)

- Padrao: Todo o periodo. Hoje, mes, ano e datas personalizadas usam `saleDate` para vendas e `paymentDate` para recebimentos. Saldo e o saldo atual das vendas feitas no periodo.
- Clientes e estoque sao totais atuais, independentes do periodo. Estoque soma `stockQuantity` (unidades), nao documentos de produto; o total de cadastros aparece separado.
- Para cada venda com `payments`, usar esse historico; caso contrario, usar `financeiroRecebimentos`. O vinculo e por ID exato da venda ou da conta. Valores acumulados `paidAmount`, `amountPaid` e `receivedAmount` nao sao somados novamente aos pagamentos.
- Historicos divergentes, valores invalidos e vencimentos incompletos pedem conferencia, nao quitacao automatica. Contas sem venda nao criam vendas nem aumentam o saldo das vendas.
- Estoque baixo no aviso significa 1 a 5 unidades; esgotado significa zero. Esse criterio e apenas de exibicao, nao uma configuracao gravada nos produtos.
- Os avisos abrem as listas gerais de Vendas/Produtos; essas telas ainda nao possuem filtros de chegada para esses avisos. Nova venda e Cadastrar cliente abrem os formularios existentes; Receber pagamento abre o Financeiro para selecionar a conta.
- Leituras ficam limitadas a `users/{uid}`. Dados vindos somente do cache nao sao apresentados como numeros confirmados. Nao ha gravacoes no Dashboard.

Teste especifico de calculos: `node scripts/test-dashboard-summary.mjs`.
O teste existente `scripts/test-query-pages.mjs` cobre periodos, acessos, erros,
cache e telas pequenas. Com `JN_SCREENSHOT_DIR=/tmp`, gera capturas ficticias em
1440, 1366, 390 e 320 pixels. Nenhum dado real e utilizado nos testes.

Todos os caminhos abaixo sao relativos a `users/{uid}` do usuario autenticado.

| Aba | Colecoes e vinculos |
| --- | --- |
| Clientes | `clients`; identidade pelo ID do documento, sem exigir `createdAt`. |
| Vendas | `sales`; cliente por `clientId`, vencimentos por `financeiroReceber.saleId` ou cronograma `dueDates` da propria venda. |
| Financeiro | `financeiroReceber`, `financeiroRecebimentos`, `sales` e `clients`. Pagamentos podem informar `receivableId` e `saleId`. |
| Dashboard | Mesmas vendas de `sales`, observadas em tempo real. Estoque permanece independente dos filtros de vendas. |

As consultas de clientes, vendas, contas e recebimentos ordenam localmente:
`orderBy` no Firestore excluiria documentos sem o campo de ordenacao.
IDs gravados dentro dos dados nao substituem o ID real do documento.

Contas sem `saleId` e contas cuja venda nao foi localizada continuam no Financeiro.
Elas nao geram vendas nem entram no valor vendido. Nomes iguais nao criam vinculos.
O resumo original do Dashboard ja consultava vendas sem `orderBy`; a ausencia de
`saleDate`, isoladamente, nao explica o zero original nesse resumo.

## Consulta e conferencias

- Venda e vencimento possuem periodos separados e inclusivos. Datas ausentes aparecem sem filtros, mas nao pertencem a um periodo informado.
- Datas ISO, brasileiras e Timestamp sao apresentadas como `dd/mm/aaaa`. Nao se usa vencimento ou cadastro como data de venda.
- Pendentes inclui parciais e atrasados. Atraso exige saldo positivo e vencimento anterior a hoje; nunca quita uma conta.
- Financeiro mostra situacao calculada, status salvo, saldo e vinculo da venda. Divergencias nao alteram registros.
- Total recebido em contas usa `receivedAmount`. Recebimentos por periodo usam o historico `financeiroRecebimentos`, sem somar novamente o acumulado das contas. Historico ausente nao ganha data ou pagamento presumido.
- Indicadores financeiros sao gerais; filtros financeiros restringem a lista de contas. No Dashboard os filtros restringem os indicadores de vendas, nao o estoque.
- Campos monetarios ausentes ou invalidos nao sao inferidos de outros registros. Vendas sem valor sao contadas, mas nao contribuem para a soma dos valores conhecidos.

Para concluir a auditoria real, e necessario acesso autenticado autorizado ou uma
exportacao somente leitura das quatro colecoes do mesmo UID: IDs, vinculos, datas,
valores, valores recebidos e status. Nao compartilhar senhas, tokens ou chaves privadas.
Sem isso, nao ha confirmacao da quantidade real de contas pendentes ou sem venda.
Quitacao, correcao ou remocao de registros exige uma etapa posterior autorizada,
apos confronto com os comprovantes. Nenhuma migracao e executada por estas consultas.

## Testes sem dados reais

```sh
node scripts/test-record-filters.mjs
npm run build
npm run dev -- --host 0.0.0.0
# Em outro terminal, com Chromium e suas dependencias disponiveis:
node scripts/test-query-pages.mjs
```

O teste de interface exige servidor Vite local (padrao `http://localhost:5173`,
ajustavel por `JN_TEST_URL`). Ele substitui autenticacao e Firestore, bloqueia
operacoes de gravacao e requisicoes externas, e confere as quatro abas em desktop/mobile.
Fixtures sao ficticias e nunca sao enviadas ao Firebase. Os scripts antigos de
recibo e reproducao criam dados: nao devem ser usados para esta auditoria.
