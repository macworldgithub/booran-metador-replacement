export enum RooftopId {
  CRANBOURNE_KIA = 'cranbourne_kia',
  CRANBOURNE_MG = 'cranbourne_mg',
  GEELY_CRANBOURNE = 'geely_cranbourne',
}

export enum ProspectStatus {
  NEW = 'new',
  IN_JOURNEY = 'in_journey',
  WAITING_ON_US = 'waiting_on_us',
  WAITING_ON_CUSTOMER = 'waiting_on_customer',
  OPTED_OUT = 'opted_out',
  CLOSED = 'closed',
}

export enum ThreadEventType {
  AUTOMATED_OUTBOUND = 'automated_outbound',
  STAFF_OUTBOUND = 'staff_outbound',
  CUSTOMER_INBOUND = 'customer_inbound',
  SYSTEM = 'system',
  INTERNAL_NOTE = 'internal_note',
}

export enum DeliveryStatus {
  PENDING = 'pending',
  DELIVERED = 'delivered',
  FAILED = 'failed',
}

export enum ProspectOutcome {
  APPOINTMENT_REQUESTED = 'appointment_requested',
  NOT_INTERESTED = 'not_interested',
  ALREADY_BOUGHT = 'already_bought',
  WRONG_NUMBER = 'wrong_number',
  HANDED_TO_SALESPERSON = 'handed_to_salesperson',
}

export enum JourneyAction {
  PAUSE = 'pause',
  RESUME = 'resume',
  SKIP_STEP = 'skip_step',
  STOP = 'stop',
}

export enum UserRole {
  SALESPERSON = 'salesperson',
  BDC = 'bdc',
  SALES_MANAGER = 'sales_manager',
  GROUP_ADMIN = 'group_admin',
  READ_ONLY = 'read_only',
}
