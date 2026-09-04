# 🖋️ Ninx Signature Page

Página pública de assinatura eletrônica de documentos do sistema **Ninx**. Sem autenticação: a segurança do fluxo depende da imprevisibilidade do GUID do documento, recebido via link ou QR code.

## Sobre o sistema Ninx

Este repositório é um dos três que compõem o Ninx:

| Repositório | Papel |
|---|---|
| [ninx-api](../ninx-api) | Backend consumido por esta página (documentos e confirmação de assinatura). |
| [ninx-front](../ninx-front) | Aplicativo desktop (ERP/POS) que gera o link/QR code para esta página. |
| **ninx-signatureWebPage** (este) | Página pública onde o cliente final assina documentos de venda. |

Fluxo: o `ninx-front` gera um link `{esta-página}/?guid={DocumentoGuid}` (ou `/documento/{guid}`) e o exibe como QR code para o cliente escanear. Esta página busca o documento em `GET {API_BASE}/api/AssinaturaEletronica/{guid}`, deixa o cliente desenhar a assinatura sobre o PDF (via `pdf.js` para renderizar e `pdf-lib` para gravar os traços no PDF final) e envia o resultado em `POST {API_BASE}/api/AssinaturaEletronica/confirmar/{guid}`. O `ninx-front` detecta a conclusão via polling no backend.

## Stack

Página estática, sem build/dependência de gerenciador de pacotes — apenas HTML/CSS/JS puro, com duas bibliotecas carregadas via CDN:

- [pdf.js](https://mozilla.github.io/pdf.js/) — renderização do PDF na tela.
- [pdf-lib](https://pdf-lib.js.org/) — desenha os traços da assinatura sobre o PDF original e gera o PDF assinado.

## Estrutura do projeto

```text
src/
├── index.html
├── style.css
└── app.js
```

## Como rodar localmente

Basta servir a pasta `src/` como arquivos estáticos, por exemplo:

```
npx serve src
```

ou a extensão "Live Server" do VS Code apontando para `src/index.html`.

Para testar o fluxo completo, ajuste a constante `API_BASE` no topo de `src/app.js` para apontar para a instância do `ninx-api` desejada (local ou produção), e acesse `http://localhost:<porta>/?guid=<algum-guid-valido>`.

## Deploy

Hoje feito manualmente no Render.com como site estático, com diretório de publicação `src/`. Não há CI/CD nem configuração de deploy versionada neste repositório.

## Fluxo de branches

Desenvolvimento na branch `dsv`; PR para `master`/`main` quando a funcionalidade estiver pronta (GitFlow).
