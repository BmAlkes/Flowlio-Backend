# T27A/B — Central de atenção e gestão da fila

## Escopo

Dashboard → Central de atenção (`/dashboard/attention`), disponível para proprietários e gestores. Dados financeiros continuam limitados aos papéis com acesso a custos internos.

Cinco fontes atuais, sem gerar tarefas ou enviar mensagens:

- Aprovações pendentes há mais dias que o limiar, vinculadas ao cliente e à versão de entrega ainda vigente.
- Minutos concluídos, faturáveis e sem vínculo com fatura, no período UTC escolhido.
- Carga estimada conhecida acima da disponibilidade semanal conhecida, usando a distribuição da T21.
- Propostas pendentes sem atualização há mais dias que o limiar.
- Custos conhecidos (despesas mais mão de obra estimada da T19) acima do percentual configurado do orçamento. Não é previsão de custo final; pressupostos incompletos são indicados.

Limiares por organização: 7 dias para aprovação, 14 para proposta, 60 minutos não faturados e 80% de orçamento como valores iniciais visíveis e editáveis. O período financeiro aceita até 366 dias; a capacidade usa uma semana UTC independente. Links de rentabilidade, capacidade e propostas preservam o contexto de origem.

## Gestão e limites

Responsável deve ser membro ativo da organização. Busca de pessoas limitada a 30 resultados, com filtro textual. Adiamento de 1, 3, 7 ou 30 dias pela interface; API limita a 90 dias. Filtros por tipo, situação e responsável; agrupamento dos itens da página por tipo. Até 25 itens por página, ordenados por data e chave estável.

A fila é calculada a partir dos dados atuais, sem duplicar o estado de decisão dos módulos de origem. Resolver a origem remove o item. Mudança nos dados que sustentam o alerta invalida seu adiamento; vínculo de responsável é preservado. Reenvios de atribuição atualizam a mesma chave. Adiamentos vencidos são apresentados como ativos.

Consultas agregadas no PostgreSQL; nenhum carregamento integral da organização no navegador. Fontes privadas respeitam visibilidade de projeto/tarefa. Horas e orçamento não aparecem para gestores sem acesso financeiro. Sem moeda ou orçamento válido não há alerta de orçamento; ausência de custo/disponibilidade é informada. A fila não garante cobertura de fatos sem dados suficientes nem substitui os relatórios de origem. Atualização a cada minuto e ao retornar à janela.

## Design e validação

Fila central com ícones e faixa lateral por tipo; regras e cobertura na lateral. Azul Flowlio `#1797ba`, texto de ação `#11718c`, âmbar para orçamento/carga e tokens existentes para fundos, bordas e textos. Fontes e escala 12/14/16/24 px preservadas. Responsividade com filtros empilhados; popup de gestão acessível pelo teclado; EN/PT/ES/HE.

Validação local: 309 testes backend, 190 frontend, lint e builds aprovados. Testes adicionais após a revisão final em andamento. Revisão Chrome com dados fictícios: 1440/390/320 px, tema escuro, RTL, abertura por Enter, fechamento por Escape, atribuição e adiamento, vazio e erro; nenhum erro JavaScript ou overflow. Nenhuma mutação em dados reais.

Migração aditiva `0013_attention_center`, com snapshot e journal. Publicar backend antes do frontend. Recuperação por correção adiante, sem apagar tabelas ou histórico de migrações. Branch `feat/t27-attention-center`; publicação em andamento.
