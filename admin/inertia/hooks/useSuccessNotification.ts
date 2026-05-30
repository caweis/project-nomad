// Helper hook to show success notifications. Mirrors useErrorNotification
// so consumers don't have to reach into NotificationContext directly when
// they only need one notification type.
import { useNotifications } from '../context/NotificationContext'

const useSuccessNotification = () => {
  const { addNotification } = useNotifications()

  const showSuccess = (message: string, duration?: number) => {
    addNotification({ message, type: 'success', duration })
  }

  return { showSuccess }
}

export default useSuccessNotification
