type ActiveRecipientById = {
  id: string;
  display_name: string;
  phone_e164: string | null;
};

type ActiveRecipientByPhone = {
  id: string;
  display_name: string;
};

/** Busca destinatarios activos en un único punto para evitar consultas divergentes. */
export async function findActiveRecipientById(
  database: D1Database,
  recipientId: string,
) {
  return database.prepare(
    `SELECT u.id, u.display_name, d.phone_e164
     FROM users u
     LEFT JOIN payment_directory d ON d.user_id = u.id AND d.discoverable = 1
     WHERE u.id = ? AND (u.role = 'client' OR EXISTS (
       SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
     )) AND u.status = 'active' AND u.deleted_at IS NULL
     LIMIT 1`,
  ).bind(recipientId).first<ActiveRecipientById>();
}

/** Busca un teléfono visible asociado a una cuenta cliente activa. */
export async function findActiveRecipientByPhone(
  database: D1Database,
  phoneE164: string,
) {
  return database.prepare(
    `SELECT u.id, u.display_name
     FROM payment_directory d
     JOIN users u ON u.id = d.user_id
     WHERE d.phone_e164 = ? AND d.discoverable = 1
       AND (u.role = 'client' OR EXISTS (
         SELECT 1 FROM user_roles ur WHERE ur.user_id = u.id AND ur.role = 'client'
       )) AND u.status = 'active' AND u.deleted_at IS NULL
     LIMIT 1`,
  ).bind(phoneE164).first<ActiveRecipientByPhone>();
}
