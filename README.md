# VORN Policy Builder SaaS

A premium, high-performance document generation engine built for insurance and policy management professionals. VORN allows users to create, preview, and export pixel-perfect PDFs with zero latency.

![VORN Preview](public/vorn-preview.png) *(Note: Placeholder image ref)*

## ✨ Key Features

- **🚀 Ultra-Fast Sync Engine**: Real-time PDF generation with an intelligent 1.2s debounced sync. Typing and editing have 0ms latency.
- **📑 Recursive PDF Engine**: Powerful document parser that converts complex HTML and tabular data into high-fidelity PDFs.
- **💎 Premium UX/UI**: Glassmorphic, state-of-the-art interface with built-in Light/Dark mode support.
- **🧩 Smart Variables**: Drag-and-drop variable injection system (e.g., `{{CustomerName}}`) that updates the entire document instantly.
- **📦 Persistent Workspaces**: Uses browser-native **IndexedDB** for infinite offline storage of your blocks, images, and templates.
- **📄 Comparison Engine**: Specialized blocks for multi-plan comparison tables with automatic logo compression.

## 🛠 Tech Stack

- **Framework**: [Next.js 15+](https://nextjs.org/) (App Router)
- **Engine**: [@react-pdf/renderer](https://react-pdf.org/)
- **Editor**: [React Quill (New)](https://github.com/zenoamaro/react-quill)
- **Icons**: [Lucide React](https://lucide.dev/)
- **Database**: [IndexedDB](https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API) (via browser)
- **Styling**: [CSS Variables](https://developer.mozilla.org/en-US/docs/Web/CSS/Using_CSS_custom_properties) (Unified Design Tokens)

## 🚦 Getting Started

### Installation
1. Clone the repository
2. Navigate to the project directory:
   ```bash
   cd vorn-policy-builder
   ```
3. Install dependencies:
   ```bash
   npm install
   ```

### Development
Run the development server:
```bash
npm run dev
```

### Production Build
Create an optimized production bundle:
```bash
npm run build
npm run start
```

## 🌍 Deployment

This project is optimized for deployment on the **Vercel Platform**. 

1. Push your code to GitHub.
2. Import the `vorn-policy-builder` folder as a New Project in Vercel.
3. No environment variables are required for the standalone editor.

## 🛡 License

© 2024 VORN Tech. All Rights Reserved. Built for high-performance policy generation.
