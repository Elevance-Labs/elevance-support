import Box from '@mui/material/Box'
import googleChat from '../assets/google-chat.webp'

// Google Chat's own mark, shown as supplied rather than tinted to the
// surrounding text: it is a brand mark, and it is what tells the button apart
// from the app's own links. MUI's icon set has no Google Chat. Sized in em so
// it sits in a button's icon slot like any other icon.
export default function GoogleChatIcon({ sx, ...props }) {
  return (
    <Box component="img" src={googleChat} alt="" aria-hidden
      sx={{ width: '1em', height: '1em', fontSize: 20, display: 'block', ...sx }} {...props} />
  )
}
