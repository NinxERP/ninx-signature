# 🖋️ Ninx Signature Page

Página pública de assinatura eletrônica de documentos do sistema **Ninx**. Sem autenticação: a segurança do fluxo depende da imprevisibilidade do GUID do documento, recebido via link ou QR code.

## Sobre o sistema Ninx

Este repositório é um dos três que compõem o Ninx:

| Repositório | Papel |
|---|---|
| [ninx-api](../ninx-api) | Backend consumido por esta página (documentos e confirmação de assinatura). |
| [ninx-front](../ninx-front) | Aplicativo desktop (ERP/POS) que gera o link/QR code para esta página. |
| **ninx-signatureWebPage** (este) | Página pública onde o cliente final assina documentos de venda. |

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
