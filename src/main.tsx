import React from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App'
import './index.css'

const root = createRoot(document.getElementById('root')!)
root.render(
  <React.StrictMode>
    <App />
    <Toaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: '#17171a',
          color: '#f5f5f7',
          border: '1px solid #2a2a30',
          fontSize: '13px'
        }
      }}
    />
  </React.StrictMode>
)
