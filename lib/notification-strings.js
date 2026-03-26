// ---------------------------------------------------------------------------
// Server-side notification templates (ES / EN)
//
// Used by API routes and notification helpers to build localized push content.
// Mirrors the pattern of lib/i18n.js but for server-side code only.
// ---------------------------------------------------------------------------
import { adminDb } from '@/lib/firebase-admin';

const strings = {
  es: {
    // ── Parking (guest-facing) ──
    parkingAlert_title: 'Alerta de estacionamiento',
    parkingAlert_body: 'Se reportó un vehículo desconocido en el área de estacionamiento. Si es tu vehículo, muévelo a tu espacio asignado.',

    // ── Community broadcasts (guest-facing) ──
    communityParking_title: 'Alerta de estacionamiento',
    communityLaundry_title: 'Actualización de lavandería',
    communityProperty_title: 'Actualización de propiedad',
    communityGeneral_title: 'Publicación comunitaria',
    communityParking_fallback: 'Se reportó un vehículo desconocido en el área de estacionamiento.',
    communityLaundry_fallback: 'Se publicó una actualización de lavandería en el tablón comunitario.',
    communityProperty_fallback: 'Se reportó un problema en la propiedad. Revisa el tablón comunitario.',

    // ── Maintenance (guest-facing) ──
    maintenanceUpdate_title: 'Actualización de mantenimiento',
    maintenanceReceived_body: 'Tu solicitud de {category} fue recibida. ETA: {eta}',
    maintenanceReceivedNoEta_body: 'Tu solicitud de {category} fue recibida y un miembro del equipo la está revisando.',

    // ── Messages (guest-facing) ──
    newMessageFromHost_title: 'Nuevo mensaje del anfitrión',
    newMessageFromHost_body: 'Tu anfitrión te envió un mensaje',

    // ── Laundry waitlist (guest-facing) ──
    laundryRequest_title: 'Solicitud de {machine}',
    laundryRequest_body: 'Otro huésped quiere usar la {machine} cuando termines. ¡Gracias por ayudar a mantener la lavandería en movimiento!',
    laundryMachine_washer: 'lavadora',
    laundryMachine_dryer: 'secadora',

    // ── Cleaning (staff-facing) ──
    newCleaningAssignment_title: 'Nueva asignación de limpieza',
    cleaningAssignment_body: '{unit} el {date} (checkout {time})',
    cleaningAccepted_title: 'Limpieza aceptada',
    cleaningAccepted_body: '{name} aceptó la limpieza de {unit}',
    cleaningDeclined_title: 'Limpieza rechazada',
    cleaningDeclined_body: '{name} no puede aceptar la limpieza de {unit}',
    cleaningArrived_title: 'Limpieza — llegó',
    cleaningCompleted_title: 'Limpieza — completada',
    cleaningStatus_body: '{name} {status} {unit}',
    cleaningIssue_title: 'Problema de limpieza: {label}',
    cleaningIssue_body: '{unit} — {description} (reportado por {reporter})',
    cleaningIssueLabel_damage: 'Daño',
    cleaningIssueLabel_missing: 'Artículo faltante',
    cleaningIssueLabel_repair: 'Reparación necesaria',
    cleaningIssueLabel_other: 'Problema',
    cleaningStatusLabel_arrived: 'llegó a',
    cleaningStatusLabel_completed: 'completó',
    cleaningCancelled_title: 'Limpieza cancelada',
    cleaningCancelled_body: 'La limpieza de {unit} fue cancelada porque se canceló la reserva',
    cleaningReminder_title: 'Recordatorio de limpieza mañana',
    cleaningReminder_body: '{unit} — checkout {time}',

    // ── Cleaning forum ──
    forumReply_title: 'Nuevo mensaje del anfitrión',
    forumMessage_title: 'Mensaje de {name}',
    sentPhoto: 'Envió una foto',
    forumWelcome: 'Hola {name}, gracias por tu ayuda con {unit} el {date}. Aquí puedes subir las fotos de antes y después. Cualquier cosa me puedes mandar mensaje aquí, al igual que fotos. Yo te responderé. ¡Muchas gracias! 🙏',

    // ── Maintenance (staff-facing) ──
    maintenanceNew_title: 'Mantenimiento: {category} ({urgency})',
    maintenanceAcknowledged_title: 'Mantenimiento reconocido',
    maintenanceAcknowledged_body: '{name} reconoció la solicitud de {category}',
    maintenanceEtaSet_title: 'ETA de mantenimiento establecido',
    maintenanceEtaSet_body: '{name} estableció ETA: {eta} para solicitud de {category}',

    // ── Assignment acknowledgement (staff-facing) ──
    taskAcknowledged_title: 'Tarea recibida',
    taskAcknowledged_body: '{name} confirmó recibido: {taskTitle}',

    // ── Messages (staff-facing) ──
    newMessage_title: 'Nuevo mensaje',
    newMessage_body: '{guestName} te envió un mensaje',
    newMessage_defaultGuest: 'Un huésped',

    // ── Staff messages ──
    staffMessage_title: 'Mensaje del equipo',
    staffMessage_fallback: 'Nuevo mensaje',
    staffMessageFromHost_title: 'Mensaje del anfitrión',
    staffMessageFromHost_body: 'Tu anfitrión te envió un mensaje en la app',

    // ── Maintenance categories ──
    maintCat_lighting: 'iluminación',
    maintCat_water: 'agua/plomería',
    maintCat_ac_heating: 'A/C/calefacción',
    maintCat_appliance: 'electrodoméstico',
    maintCat_lock_door: 'cerradura/puerta',
    maintCat_wifi_tv: 'WiFi/TV',
    maintCat_pest: 'plaga/insecto',
    maintCat_cleaning: 'limpieza',
    maintCat_noise: 'ruido',
    maintCat_other: 'otro',

    // ── Urgency levels ──
    urgency_low: 'bajo',
    urgency_medium: 'medio',
    urgency_high: 'alto',
  },

  en: {
    // ── Parking (guest-facing) ──
    parkingAlert_title: 'Parking Alert',
    parkingAlert_body: 'An unfamiliar vehicle has been reported in the parking area. If this is your vehicle, please move it to your designated spot.',

    // ── Community broadcasts (guest-facing) ──
    communityParking_title: 'Parking Alert',
    communityLaundry_title: 'Laundry Update',
    communityProperty_title: 'Property Update',
    communityGeneral_title: 'Broadcast Post',
    communityParking_fallback: 'An unfamiliar vehicle has been reported in the parking area.',
    communityLaundry_fallback: 'A laundry update has been posted on the community board.',
    communityProperty_fallback: 'A property issue has been reported. Check the community board.',

    // ── Maintenance (guest-facing) ──
    maintenanceUpdate_title: 'Maintenance Update',
    maintenanceReceived_body: 'Your {category} request has been received. ETA: {eta}',
    maintenanceReceivedNoEta_body: 'Your {category} request has been received and a team member is looking into it.',

    // ── Messages (guest-facing) ──
    newMessageFromHost_title: 'New Message from Host',
    newMessageFromHost_body: 'Your host sent you a message',

    // ── Laundry waitlist (guest-facing) ──
    laundryRequest_title: '{machine} Request',
    laundryRequest_body: 'Another guest would love to use the {machine} when you\'re done. Thanks for helping keep laundry moving!',
    laundryMachine_washer: 'Washer',
    laundryMachine_dryer: 'Dryer',

    // ── Cleaning (staff-facing) ──
    newCleaningAssignment_title: 'New Cleaning Assignment',
    cleaningAssignment_body: '{unit} on {date} (checkout {time})',
    cleaningAccepted_title: 'Cleaning Accepted',
    cleaningAccepted_body: '{name} accepted cleaning for {unit}',
    cleaningDeclined_title: 'Cleaning Declined',
    cleaningDeclined_body: '{name} cannot accept cleaning for {unit}',
    cleaningArrived_title: 'Cleaning — arrived at',
    cleaningCompleted_title: 'Cleaning — completed',
    cleaningStatus_body: '{name} {status} {unit}',
    cleaningIssue_title: 'Cleaning Issue: {label}',
    cleaningIssue_body: '{unit} — {description} (reported by {reporter})',
    cleaningIssueLabel_damage: 'Damage',
    cleaningIssueLabel_missing: 'Missing item',
    cleaningIssueLabel_repair: 'Repair needed',
    cleaningIssueLabel_other: 'Issue',
    cleaningStatusLabel_arrived: 'arrived at',
    cleaningStatusLabel_completed: 'completed',
    cleaningCancelled_title: 'Cleaning Cancelled',
    cleaningCancelled_body: 'Cleaning for {unit} was cancelled because the booking was cancelled',
    cleaningReminder_title: 'Cleaning Reminder — Tomorrow',
    cleaningReminder_body: '{unit} — checkout {time}',

    // ── Cleaning forum ──
    forumReply_title: 'New message from host',
    forumMessage_title: 'Message from {name}',
    sentPhoto: 'Sent a photo',
    forumWelcome: 'Hi {name}, thanks for your help with {unit} on {date}. You can upload before and after photos here. Feel free to message me with any questions or photos — I\'ll respond. Thank you! 🙏',

    // ── Maintenance (staff-facing) ──
    maintenanceNew_title: 'Maintenance: {category} ({urgency})',
    maintenanceAcknowledged_title: 'Maintenance Acknowledged',
    maintenanceAcknowledged_body: '{name} acknowledged the {category} request',
    maintenanceEtaSet_title: 'Maintenance ETA Set',
    maintenanceEtaSet_body: '{name} set ETA: {eta} for {category} request',

    // ── Assignment acknowledgement (staff-facing) ──
    taskAcknowledged_title: 'Task Acknowledged',
    taskAcknowledged_body: '{name} acknowledged: {taskTitle}',

    // ── Messages (staff-facing) ──
    newMessage_title: 'New Message',
    newMessage_body: '{guestName} sent you a message',
    newMessage_defaultGuest: 'A guest',

    // ── Staff messages ──
    staffMessage_title: 'Staff Message',
    staffMessage_fallback: 'New message',
    staffMessageFromHost_title: 'Message from Host',
    staffMessageFromHost_body: 'Your host sent you a message in the app',

    // ── Maintenance categories ──
    maintCat_lighting: 'Lighting',
    maintCat_water: 'Water / Plumbing',
    maintCat_ac_heating: 'AC / Heating',
    maintCat_appliance: 'Appliance',
    maintCat_lock_door: 'Lock / Door',
    maintCat_wifi_tv: 'WiFi / TV',
    maintCat_pest: 'Pest / Bug',
    maintCat_cleaning: 'Cleaning',
    maintCat_noise: 'Noise Issue',
    maintCat_other: 'Other',

    // ── Urgency levels ──
    urgency_low: 'Low',
    urgency_medium: 'Medium',
    urgency_high: 'High',
  },
};

// ---------------------------------------------------------------------------
// nt — server-side notification template resolver
//
// @param {string} locale  'en' or 'es'
// @param {string} key     Template key
// @param {object} params  Interpolation values, e.g. { category: 'Lighting' }
// @returns {string}
// ---------------------------------------------------------------------------
export function nt(locale, key, params = {}) {
  const str = strings[locale]?.[key] || strings.en[key] || key;
  return Object.entries(params).reduce(
    (s, [k, v]) => s.replaceAll(`{${k}}`, v),
    str
  );
}

// ---------------------------------------------------------------------------
// getGuestLocale — resolve a guest's preferred language from Firestore
//
// Checks notification_prefs/{bookingCode}.locale, defaults to 'en'.
// ---------------------------------------------------------------------------
export async function getGuestLocale(bookingCode) {
  if (!bookingCode) return 'en';
  try {
    const doc = await adminDb.collection('notification_prefs').doc(bookingCode).get();
    const locale = doc.exists ? doc.data().locale : null;
    return locale === 'es' ? 'es' : 'en';
  } catch (err) {
    console.error('[getGuestLocale] Error:', err.message);
    return 'en';
  }
}

// ---------------------------------------------------------------------------
// getStaffLocale — resolve a staff member's preferred language
//
// Checks users/{uid}.locale. Defaults to 'es' for cleaners, 'en' for others.
// ---------------------------------------------------------------------------
export async function getStaffLocale(uid) {
  if (!uid) return 'en';
  try {
    const doc = await adminDb.collection('users').doc(uid).get();
    if (!doc.exists) return 'en';
    const data = doc.data();
    if (data.locale === 'es' || data.locale === 'en') return data.locale;
    // Role-based default: cleaners default to Spanish
    return data.role === 'cleaner' ? 'es' : 'en';
  } catch (err) {
    console.error('[getStaffLocale] Error:', err.message);
    return 'en';
  }
}

// ---------------------------------------------------------------------------
// maintCategory — resolve localized maintenance category label
// ---------------------------------------------------------------------------
export function maintCategory(locale, category) {
  return nt(locale, `maintCat_${category}`);
}

export default strings;
