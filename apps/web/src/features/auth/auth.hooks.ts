import { useMutation } from '@tanstack/react-query';
import { useAuthContext } from './auth.context';

export { useAuthContext as useAuth } from './auth.context';

export function useLogin() {
  const { login } = useAuthContext();
  return useMutation({ mutationFn: login });
}

export function useRegister() {
  const { register } = useAuthContext();
  return useMutation({ mutationFn: register });
}

export function useLogout() {
  const { logout } = useAuthContext();
  return useMutation({ mutationFn: logout });
}

export function useSilentRefresh() {
  const { refresh } = useAuthContext();
  return useMutation({ mutationFn: refresh });
}
