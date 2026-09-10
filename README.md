<div align="center">

# 🖋️ ninx-signature

**Página pública de assinatura eletrônica de documentos do sistema Ninx.**

![HTML](https://img.shields.io/badge/HTML5-static-E34F26?logo=html5&logoColor=white)
![pdf.js](https://img.shields.io/badge/pdf.js-render-orange)
![pdf--lib](https://img.shields.io/badge/pdf--lib-signature-blueviolet)
![License](https://img.shields.io/badge/licença-privado-lightgrey)

</div>

---

Página pública de assinatura eletrônica de documentos do sistema **Ninx**. Sem autenticação:
a segurança do fluxo depende da imprevisibilidade do GUID do documento, recebido via link ou
QR code.

## 🧩 Sobre o sistema Ninx

Este repositório é um dos cinco que compõem o Ninx:

| Repositório | Papel |
|---|---|
| [ninx-api](../ninx-api) | Backend consumido por esta página (documentos e confirmação de assinatura). |
| [ninx-front](../ninx-front) | Cliente desktop atual (ERP/POS), em Tauri v2 + React — gera o link/QR code para esta página. |
| [old-ninx-front](../old-ninx-front) | Cliente desktop antigo, em .NET MAUI — **descontinuado**, mantido só como referência histórica. |
| **ninx-signature** (este) | Página pública onde o cliente final assina documentos de venda. |
| [docs](../docs) | Documentação complementar (auditoria da migração de frontend, notas de arquitetura). |

## ⚙️ Stack

Página estática, sem build/dependência de gerenciador de pacotes — apenas HTML/CSS/JS puro,
com duas bibliotecas carregadas via CDN:

- [pdf.js](https://mozilla.github.io/pdf.js/) — renderização do PDF na tela.
- [pdf-lib](https://pdf-lib.js.org/) — desenha os traços da assinatura sobre o PDF original e gera o PDF assinado.

## 🗂️ Estrutura do projeto

```text
src/
├── index.html
├── style.css
└── app.js
```
