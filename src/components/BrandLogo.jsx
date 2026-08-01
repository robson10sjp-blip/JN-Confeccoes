import { useState } from 'react'
import logo from '../assets/logo.png'

function BrandLogo({ className = '', showName = false }) {
  const [imageReady, setImageReady] = useState(true)

  return (
    <div className={`brand-logo ${className}`.trim()} aria-label="Logo JN Confecções">
      {imageReady ? (
        <img
          src={logo}
          alt="JN Confecções"
          className="brand-logo-image"
          onError={() => setImageReady(false)}
        />
      ) : (
        <span className="brand-logo-fallback">JN</span>
      )}

      {showName ? <span className="brand-logo-name">JN Confecções</span> : null}
    </div>
  )
}

export default BrandLogo