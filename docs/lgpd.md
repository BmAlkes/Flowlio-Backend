# LGPD — operação e registros

Documento interno da Flowlio para cumprir a LGPD (Lei 13.709/2018). Mantenha-o atualizado quando
surgir um novo fornecedor, um novo tipo de dado ou uma nova funcionalidade que trate dados pessoais.

## 1. Registro das operações de tratamento (art. 37)

| Operação | Titulares | Dados | Base legal | Papel da Flowlio | Retenção |
|---|---|---|---|---|---|
| Conta e assinatura | Usuários, donos de organização | Nome, e-mail, senha (hash), telefone, endereço, cobrança | Contrato (art. 7º, V) | Controladora | Enquanto ativa; 90 dias após encerramento |
| Registros de acesso | Usuários | IP, data/hora, user agent (`session`) | Obrigação legal — Marco Civil art. 15 | Controladora | 6 meses |
| Cobrança e fiscal | Donos de organização | Dados de faturamento, transações PayPal | Obrigação legal (art. 7º, II) | Controladora | 5 anos |
| CRM, leads, propostas, faturas | Clientes e leads das organizações | Nome, e-mail, telefone, CPF/CNPJ, endereço, notas | Definida pela organização | Operadora | Definida pela organização |
| Webhook de leads | Leads das organizações | Payload bruto (`lead_webhook_logs`) | Definida pela organização | Operadora | 90 dias |
| Assistente de IA (Lio) | Usuários; dados citados nas perguntas | Perguntas, respostas, anexos | Contrato | Controladora / operadora | Conversas 180 dias; anexos 24 h |
| WhatsApp (Lio) | Usuários | Telefone, mensagens | Contrato | Controladora | Enquanto vinculado |
| Google Agenda | Usuários e participantes de eventos | Eventos, tokens OAuth (criptografados) | Consentimento | Controladora | Até desconectar |
| Notificações | Usuários | Título, mensagem | Contrato | Controladora | 12 meses |
| Auditoria | Usuários | Ação, IP, user agent | Legítimo interesse (segurança) | Controladora | IP/UA anonimizados após 12 meses |
| Newsletter | Assinantes | E-mail | Consentimento | Controladora | Até o descadastro (e-mail mantido como lista de supressão) |
| Cookies de marketing | Visitantes | Eventos de navegação (Meta Pixel) | Consentimento | Controladora | Definido pela Meta |
| Pedidos de titulares | Solicitantes | Tipo, data, status (`privacy_requests`) | Obrigação legal / exercício de direitos | Controladora | 5 anos |

A limpeza automática roda a cada hora no worker (`src/modules/privacy/service.ts`, `RETENTION`).
Se um prazo mudar, altere o código **e** a Política de Privacidade (`Flowlio-Frontend/src/data/legal`).

## 2. Suboperadores

Railway (hospedagem), Cloudinary (arquivos), Brevo (e-mail), OpenAI (IA), Google (Agenda),
Meta (WhatsApp Cloud API, Pixel), PayPal (pagamentos), Sentry (erros), serviços de push dos navegadores.
Para cada um: guardar o DPA/termos de tratamento assinados ou aceitos e confirmar a região dos dados.
Um novo fornecedor só entra depois de ser incluído na Política de Privacidade.

## 3. Pedidos de titulares (art. 18 e 19) — prazo: 15 dias

- **Exportação**: o próprio usuário baixa em Configurações > Privacidade e dados (`GET /api/user/privacy/export`).
- **Exclusão de membro, gestor ou cliente do portal**: automática (`POST /api/user/privacy/delete-account`).
  A conta é anonimizada; tarefas e projetos da organização permanecem sem o nome da pessoa.
- **Exclusão de dono de organização**: vira pedido pendente e gera e-mail para `PRIVACY_CONTACT_EMAIL`.
  1. Confirmar a identidade, se houver dúvida.
  2. Excluir a organização em Super Admin > Empresas.
  3. Concluir o pedido em Configurações do Super Admin > Pedidos LGPD (anonimiza a conta do dono).
- **Pedidos por e-mail** (correção, oposição, revisão de decisão automatizada, informação): responder pelo
  canal do Encarregado em até 15 dias e registrar a resposta.
- **Cliente ou lead de uma organização**: encaminhar à organização (controladora) e ajudá-la a atender.

## 4. Resposta a incidentes (art. 48 e Resolução CD/ANPD nº 15/2024)

1. **Conter** (imediato): revogar credenciais expostas, bloquear o acesso indevido, preservar logs.
2. **Avaliar** (até 24 h): que dados, quantos titulares, quais organizações, se há risco ou dano relevante
   (dados sensíveis, financeiros, de autenticação, em larga escala, de crianças).
3. **Comunicar** em até **3 dias úteis** a partir do conhecimento, se houver risco relevante:
   - ANPD, pelo formulário oficial em gov.br/anpd;
   - titulares afetados, em linguagem clara;
   - organizações afetadas (como operadora, a Flowlio avisa a controladora sem demora).
4. **Registrar** todo incidente, mesmo sem comunicação, e guardar o registro por 5 anos.
5. **Corrigir** a causa e revisar este documento.

## 5. Variáveis de ambiente

- `PRIVACY_CONTACT_EMAIL`: caixa que recebe os pedidos de exclusão de donos de organização.
- `TOKEN_ENCRYPTION_KEY` (opcional, ≥ 32 caracteres): chave dos tokens OAuth. Sem ela, usa `BETTER_AUTH_SECRET`.
  Trocar a chave obriga os usuários a reconectar o Google Agenda.
