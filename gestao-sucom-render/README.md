# Gestão SUCOM — Render

Serviço existente: `gestao-sucom`. Branch: `gestao-sucom-render`.

## Painel

- Apenas demandas abertas, integração com os nove pipes no servidor.
- Visual sem círculos decorativos, atenção em vermelho, carga relativa em barras e filtros.
- Sem gráfico de distribuição por fase. Mantém o filtro de fase.
- Variáveis existentes preservadas: `PIPEFY_CLIENT_SECRET`, `ADMIN_PASSWORD`, `SESSION_SECRET`.

## Análise consultiva

O botão **Analisar cenário** solicita uma leitura atual dos cards abertos dos nove pipes,
incluindo campos, comentários recentes e histórico de fases. Retorna decisões para hoje,
gargalos e sugestões de organização, com links para os cards e hipóteses identificadas.

Não há ferramentas de escrita: nenhuma mudança de fase, comentário, mensagem ou atribuição.
A função GraphQL rejeita operações que não iniciem com `query`. O modelo recebe somente
um contexto estruturado, não tem ferramentas e trata conteúdo de cards como dados não confiáveis.
IDs de todas as referências são conferidos com o cenário aberto antes de exibir a resposta.

### Ativação no serviço existente

Adicionar no Environment do Render, sem substituir as variáveis existentes:

- `OPENAI_API_KEY`: chave de um projeto OpenAI com crédito e acesso ao modelo. Nunca salvar no Git ou frontend.
- `OPENAI_MODEL`: padrão `gpt-5-mini`.
- `AI_ENABLED`: `true` para ativar; `false` suspende novas análises.

Sem chave, a interface exibe **aguardando ativação**. Não usa dados fictícios nem apresenta
regras fixas como se fossem IA. A assinatura ChatGPT não é utilizada pelo código.
Configurar limites de gasto no projeto do provedor antes de fornecer a chave.

Não há chamadas à IA na inicialização, login ou atualização do dashboard. Apenas um clique
explícito gera uma solicitação. Cliques simultâneos compartilham a execução e a análise é
reaproveitada por 15 minutos. O relatório fica em memória e desaparece após reinício; o
intervalo não é um teto financeiro persistente. O POST exige sessão e cabeçalho de mesma origem.
Erros do provedor não expõem chaves nem conteúdos em logs. `store:false` é enviado à API;
isso não constitui garantia de retenção zero por parte do provedor.

### Limites de leitura

- Até 300 cards abertos; bloqueia a execução acima disso, sem escolher silenciosamente um recorte.
- Até 35 campos preenchidos, 10 comentários recentes e 20 passagens de fase por card;
  campos até 2.200 caracteres e comentários até 1.400. Cortes são declarados no relatório.
- Campos com nomes de contatos, documentos, pacientes, credenciais e anexos são omitidos;
  e-mails, CPFs e URLs no texto são removidos por regras básicas. Isso não é anonimização completa.
- Anexos não são baixados ou enviados. Disponibilidade e atribuições precisam ser confirmadas pelo gestor.
- Até 180 mil caracteres de contexto e 6.500 tokens de saída; contextos maiores são rejeitados.
- Falha na leitura de qualquer pipe impede gerar uma análise global incompleta.
- Hoje é calculado em America/Sao_Paulo; relatório antigo mostra a data de referência.

## Validação

`npm test`: exclusão de concluídos, referências inválidas, leitura incompleta, ausência de chave,
recusa ou saída incompleta do provedor, deduplicação e mudança de dia em São Paulo.

`/api/health`: status da integração, versão e disponibilidade da IA, sem segredos.
O startup consulta um card de cada pipe (quando houver) com o schema detalhado e registra
apenas a contagem de pipes validados em `[advisory-read-check]`; não chama a IA.
