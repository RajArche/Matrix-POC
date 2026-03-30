export const STORAGE_KEYS = {
  TOKEN:     'mx_access_token',
  USER_ID:   'mx_user_id',
  DEVICE_ID: 'mx_device_id',
};

export const getSession = () => {
  const accessToken = localStorage.getItem(STORAGE_KEYS.TOKEN);
  const userId      = localStorage.getItem(STORAGE_KEYS.USER_ID);
  const deviceId    = localStorage.getItem(STORAGE_KEYS.DEVICE_ID);
  if (!accessToken || !userId) return null;
  return { accessToken, userId, deviceId };
};

export const saveSession = ({ accessToken, userId, deviceId }) => {
  localStorage.setItem(STORAGE_KEYS.TOKEN,     accessToken);
  localStorage.setItem(STORAGE_KEYS.USER_ID,   userId);
  localStorage.setItem(STORAGE_KEYS.DEVICE_ID, deviceId ?? '');
};

export const clearSession = () => {
  Object.values(STORAGE_KEYS).forEach(k => localStorage.removeItem(k));
};
