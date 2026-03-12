const translations = {
  es: {
    // Header / Nav
    myCleanings: 'Mis Limpiezas',
    upcomingCleanings: 'Próximas Limpiezas',
    todaysCleaning: 'Limpieza de Hoy',
    signOut: 'Cerrar Sesión',
    language: 'ES',

    // Job card
    unit: 'Unidad',
    date: 'Fecha',
    checkoutTime: 'Hora de Salida',
    notes: 'Notas',
    sameDayArrival: 'Llegada el mismo día',

    // Step 1: Acknowledge
    newJobScheduled: 'Nueva limpieza programada',
    confirm: 'Confirmar',

    // Step 2: En Route
    onMyWay: 'Voy en Camino',

    // Step 3: Arrived
    iArrived: 'Llegué',

    // Step 4: Before Photos
    beforePhotos: 'Fotos de Antes',
    takePhoto: 'Tomar Foto',
    continue: 'Continuar',
    photosRequired: 'Se requiere al menos 1 foto',

    // Step 5: Cleaning
    cleaningInProgress: 'Limpieza en Progreso',
    reportIssue: 'Reportar Problema',
    readyForPhotos: 'Listo para Fotos',

    // Step 5b: Issue report
    damage: 'Daño',
    missingItem: 'Faltante',
    repairNeeded: 'Reparación',
    other: 'Otro',
    describeIssue: 'Describa el problema (opcional)',
    sendReport: 'Enviar Reporte',
    issueReported: 'Problema reportado',
    cancel: 'Cancelar',

    // Step 6: After Photos
    afterPhotos: 'Fotos de Después',

    // Step 7: Laundry
    laundryCheck: 'Revisión de Lavandería',
    laundryQuestion: '¿Se encontró algo en la lavadora o secadora?',
    noAllClean: 'No, todo limpio',
    yesSomethingFound: 'Sí, se encontró algo',
    describeFound: 'Describa lo encontrado',

    // Step 8: Complete
    cleaningComplete: '¡Limpieza Completada!',
    finish: 'Terminar',
    timeStarted: 'Hora de inicio',
    timeCompleted: 'Hora de finalización',
    photosTaken: 'Fotos tomadas',
    issuesReported: 'Problemas reportados',

    // Supply request
    supplyRequest: 'Solicitud de Suministro',
    requestSupplies: 'Solicitar Suministros',
    selectSupply: 'Seleccionar suministro...',
    addNote: 'Agregar nota (opcional)',
    submit: 'Enviar',
    requestSubmitted: 'Solicitud enviada',

    // States
    loading: 'Cargando...',
    noUpcomingJobs: 'No hay limpiezas próximas.',
    scheduled: 'Programada',
    acknowledged: 'Confirmada',
    en_route: 'En camino',
    arrived: 'Llegó',
    before_photos: 'Fotos antes',
    cleaning: 'Limpiando',
    after_photos: 'Fotos después',
    laundry_check: 'Lavandería',
    completed: 'Completada',
  },

  en: {
    myCleanings: 'My Cleanings',
    upcomingCleanings: 'Upcoming Cleanings',
    todaysCleaning: "Today's Cleaning",
    signOut: 'Sign Out',
    language: 'EN',

    unit: 'Unit',
    date: 'Date',
    checkoutTime: 'Checkout Time',
    notes: 'Notes',
    sameDayArrival: 'Same-day arrival',

    newJobScheduled: 'New cleaning scheduled',
    confirm: 'Confirm',

    onMyWay: 'On My Way',

    iArrived: "I've Arrived",

    beforePhotos: 'Before Photos',
    takePhoto: 'Take Photo',
    continue: 'Continue',
    photosRequired: 'At least 1 photo required',

    cleaningInProgress: 'Cleaning in Progress',
    reportIssue: 'Report Issue',
    readyForPhotos: 'Ready for Photos',

    damage: 'Damage',
    missingItem: 'Missing Item',
    repairNeeded: 'Repair Needed',
    other: 'Other',
    describeIssue: 'Describe the issue (optional)',
    sendReport: 'Send Report',
    issueReported: 'Issue reported',
    cancel: 'Cancel',

    afterPhotos: 'After Photos',

    laundryCheck: 'Laundry Check',
    laundryQuestion: 'Was anything found in the washer or dryer?',
    noAllClean: 'No, all clean',
    yesSomethingFound: 'Yes, something found',
    describeFound: 'Describe what was found',

    cleaningComplete: 'Cleaning Complete!',
    finish: 'Finish',
    timeStarted: 'Time started',
    timeCompleted: 'Time completed',
    photosTaken: 'Photos taken',
    issuesReported: 'Issues reported',

    supplyRequest: 'Supply Request',
    requestSupplies: 'Request Supplies',
    selectSupply: 'Select supply...',
    addNote: 'Add note (optional)',
    submit: 'Submit',
    requestSubmitted: 'Request submitted',

    loading: 'Loading...',
    noUpcomingJobs: 'No upcoming cleanings.',
    scheduled: 'Scheduled',
    acknowledged: 'Acknowledged',
    en_route: 'En Route',
    arrived: 'Arrived',
    before_photos: 'Before Photos',
    cleaning: 'Cleaning',
    after_photos: 'After Photos',
    laundry_check: 'Laundry Check',
    completed: 'Completed',
  },
};

export function t(locale, key) {
  return translations[locale]?.[key] || translations.en[key] || key;
}

export default translations;
