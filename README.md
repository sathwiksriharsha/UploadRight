# UploadRight 🚀

> **Free, 100% Private Indian Government Exam Photo & Signature Resizer and Compressor.**  
> Zero server uploads. Real-time binary-search compression and JFIF DPI injection directly inside your browser RAM.

[![Astro](https://img.shields.io/badge/Astro-5.x-BC52EE?style=flat&logo=astro)](https://astro.build)
[![Tailwind CSS](https://img.shields.io/badge/TailwindCSS-4.x-38BDF8?style=flat&logo=tailwind-css)](https://tailwindcss.com)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Privacy](https://img.shields.io/badge/Privacy-100%25%20Client--Side-green.svg)](#privacy--architecture)

---

## ✨ Features

- 🔒 **100% Client-Side Privacy**: Photos, signatures, and government identity cards never leave the user's browser. Zero backend image storage or external API calls.
- 🎯 **Binary-Search Compression**: Quantizes JPEG quality iteratively in-browser to strictly meet portal thresholds (e.g., 20–50 KB, 10–20 KB, under 100 KB).
- 🏷️ **JFIF DPI Header Injection**: Injects clean 200 DPI / 300 DPI APP0 headers into JPEG streams, ensuring automated uploaders on UPSC, SSC, and IBPS don't reject files for missing DPI metadata.
- 📐 **38+ Authoritative Exam Presets**: Official dimension, physical measurement (cm/mm/inch), file size, and background guidelines for:
  - **Central Recruitment**: SSC (CGL, CHSL, MTS, GD), UPSC OTR, Railway RRB, CTET, India Post GDS.
  - **Banking & Insurance**: IBPS PO/Clerk, SBI PO/Clerk, RBI Assistant, LIC AAO.
  - **State Police & PSCs**: UP Police, Delhi Police, UPPSC, BPSC, MPPSC, MPSC, TNPSC, WBPSC, KPSC.
  - **National Entrance Exams**: NEET UG, JEE Main, GATE, CUET.
  - **Identity Portals**: NSDL PAN, UTIITSL PAN, Passport Seva.
- 🧰 **Dedicated Generic Tools & High-Traffic Hubs**:
  - `Online Image Resizer` (`/image-resizer`): Universal exact pixel and KB resizing (20 KB, 50 KB, 100 KB).
  - `Signature Compressor` (`/signature-compressor`): Strict 10–20 KB threshold + paper whitening.
  - `Image Compressor` (`/image-compressor`): Target exact KB limits (20KB, 50KB, 100KB, 200KB).
  - `Passport Photo Resizer` (`/photo-resizer`): Universal 3.5×4.5 cm / 200 DPI passport tool.
  - `75% Face Coverage` (`/75-face-coverage`): Biometric crown-to-chin visual alignment guide overlay.
  - `Signature Resizer` (`/signature-resizer`): 140×60 px official ratio tool.
  - `Add Name & Date` (`/add-name-date`): UPSC / Govt placard slate generator.
  - `Custom Resizer` (`/custom`): Freeform px, cm, mm, inch target dimensions.
- ⚡ **Optimized for Cloudflare Pages**: Fast static build with 57 pre-rendered routes, instant TTFB, dynamic canonicals, and zero cold starts.

---

## 🛠️ Technology Stack

- **Framework**: [Astro 5](https://astro.build/) (Static Site Generation / SSG)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/)
- **Image Manipulation**: HTML5 Canvas API + `Cropper.js`
- **Metadata Engine**: Custom bounds-checked JFIF parser & ISO COM segment binary padder (`src/utils/imageEngine.ts`)
- **Hosting Target**: Cloudflare Pages / Vercel / Netlify

---

## 🚀 Getting Started

### Prerequisites

- Node.js `20.x` or higher (Node `24.x` supported)
- npm or pnpm

### Installation

```bash
git clone https://github.com/sathwiksriharsha/UploadRight.git
cd UploadRight
npm install
```

### Running Locally

```bash
npm run dev
```

Open [http://localhost:4321](http://localhost:4321) in your browser.

### Building for Production

```bash
npm run build
```

This compiles all 57 static routes and assets to the `./dist` folder.

### Running Automated Test Suite

```bash
npm test
```

Verifies:
1. Preset data validation and constraints.
2. Safe filename sanitization.
3. Binary JPEG DPI injection and verification.
4. ISO-compliant minimum-byte padding.
5. Full SEO audit (titles, descriptions, canonicals, H1s, JSON-LD schemas).
6. Broken link scan across all generated routes.

---

## ☁️ Cloudflare Pages Deployment

UploadRight is designed for zero-configuration deployment on Cloudflare Pages:

1. Log into your [Cloudflare Dashboard](https://dash.cloudflare.com/) → **Workers & Pages**.
2. Click **Create Application** → **Pages** → **Connect to Git**.
3. Select the `UploadRight` repository.
4. Set build settings:
   - **Framework preset**: `Astro`
   - **Build command**: `npm run build`
   - **Build output directory**: `dist`
   - **Environment variables**:
     - `NODE_VERSION` = `22` *(Cloudflare Pages V2 image native cached LTS)*
     - `PUBLIC_SITE_URL` = *(Optional: Defaults to `https://uploadright.pages.dev` for ₹0 startup; set to `https://uploadright.in` when you attach a custom domain so canonical tags and sitemaps match automatically)*
5. Click **Save and Deploy**.

The included `public/_headers` and `public/_redirects` files will automatically configure caching headers, clean 301 redirects, and security policies.

---

## 📄 License

MIT License. Free to use for personal and commercial applications.
