
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.tsx'
import './index.css'
import { defineCustomElements } from '@ionic/pwa-elements/loader';
import { Toaster as ShadcnToaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { ThemeProvider } from "next-themes"

// Call the element loader after the platform has been bootstrapped
defineCustomElements(window);

// Mount the app
const rootElement = document.getElementById("root")
if (rootElement) {
  createRoot(rootElement).render(
    <BrowserRouter>
      <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
        <App />
        <ShadcnToaster />
        <SonnerToaster position="top-right" closeButton />
      </ThemeProvider>
    </BrowserRouter>
  )
} else {
  console.error("Root element not found!")
}
