import { useEffect, useState } from 'react'
import { Button, Snackbar } from '@mui/material'
import { PUBLIC_PATHS, registerServiceWorker } from '../pwa'

/**
 * "A new version is available." Shown once a newer build has been downloaded;
 * Reload switches to it. Until then the page keeps running the build it
 * started with, so nothing changes under someone mid-ticket.
 */
export default function UpdatePrompt() {
  const [apply, setApply] = useState(null)

  useEffect(() => {
    registerServiceWorker((fn) => setApply(() => fn), { skip: PUBLIC_PATHS })
  }, [])

  return (
    <Snackbar
      open={Boolean(apply)}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      message="A new version is available."
      action={<Button color="inherit" size="small" onClick={() => apply?.()}>Reload</Button>}
    />
  )
}
