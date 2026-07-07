export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type ProfileStatus = 'pending_review' | 'approved' | 'rejected' | 'suspended';
export type EmployeeStatus = 'probation' | 'active' | 'inactive' | 'left';
export type AppRole = 'super_admin' | 'admin' | 'hr' | 'manager' | 'staff';
export type LeaveType = 'annual' | 'medical' | 'unpaid' | 'replacement';
export type LeaveRequestStatus = 'pending' | 'approved' | 'rejected';
export type AttendancePunchType = 'clock_in' | 'break_start' | 'break_end' | 'clock_out';
export type ScheduleEventType = 'meeting' | 'training' | 'shooting' | 'live' | 'visit' | 'other';
export type ScheduleEventStatus = 'active' | 'cancelled';
export type RecurringTodoFrequency = 'daily' | 'weekly' | 'monthly' | 'month_end' | 'custom';

export type Profile = {
  id: string;
  email: string;
  full_name: string;
  nickname: string | null;
  phone: string | null;
  gender: string | null;
  birthday: string | null;
  identity_number: string | null;
  avatar_url: string | null;
  role: AppRole;
  status: ProfileStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  region_id: string | null;
  can_view_all_regions: boolean;
  created_at: string;
  updated_at: string;
};

export type Region = {
  id: string;
  code: string;
  name: string;
  company_english_name: string | null;
  company_registration_no: string | null;
  company_instagram: string | null;
  company_facebook: string | null;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type EmploymentType = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type JobTitle = {
  id: string;
  name: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type Employee = {
  id: string;
  profile_id: string | null;
  employee_code: string | null;
  full_name: string;
  nickname: string | null;
  avatar_url: string | null;
  email: string | null;
  phone: string | null;
  gender: string | null;
  birthday: string | null;
  identity_number: string | null;
  address: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  bank_name: string | null;
  bank_account: string | null;
  bank_account_name: string | null;
  base_salary: number | null;
  region_id: string | null;
  employment_type_id: string | null;
  job_title_id: string | null;
  status: EmployeeStatus;
  hire_date: string | null;
  probation_confirm_date: string | null;
  start_work_time: string | null;
  end_work_time: string | null;
  require_attendance: boolean;
  reviewed_by: string | null;
  reviewed_at: string | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
};

export type LeaveRequest = {
  id: string;
  profile_id: string;
  employee_id: string | null;
  leave_type: LeaveType;
  start_date: string;
  end_date: string;
  reason: string;
  medical_attachment_url: string | null;
  status: LeaveRequestStatus;
  review_note: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AttendanceRecord = {
  id: string;
  profile_id: string;
  employee_id: string | null;
  punch_type: AttendancePunchType;
  punched_at: string;
  photo_path: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  ip_address: string | null;
  device_info: string;
  break_minutes: number | null;
  overtime_minutes: number | null;
  is_abnormal: boolean;
  abnormal_types: string[];
  attendance_location_id: string | null;
  distance_meters: number | null;
  location_check_result: string | null;
  created_at: string;
};

export type AttendanceLocation = {
  id: string;
  region_id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius_meters: number;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Shift = {
  id: string;
  name: string;
  start_time: string;
  end_time: string;
  break_minutes: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ScheduleEntry = {
  id: string;
  employee_id: string;
  shift_id: string | null;
  work_date: string;
  is_day_off: boolean;
  note: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type RestDay = {
  id: string;
  employee_id: string;
  profile_id: string;
  region_id: string | null;
  rest_date: string;
  cycle_year: number;
  cycle_month: number;
  source: 'manual' | 'auto';
  status: 'confirmed' | 'cancelled';
  created_at: string;
  updated_at: string;
};

export type ScheduleEvent = {
  id: string;
  profile_id: string;
  title: string;
  event_date: string;
  start_time: string | null;
  end_time: string | null;
  location: string | null;
  note: string | null;
  event_type: ScheduleEventType;
  status: ScheduleEventStatus;
  created_at: string;
  updated_at: string;
};

export type PublicHoliday = {
  id: string;
  holiday_name: string;
  holiday_date: string;
  region_id: string | null;
  note: string | null;
  is_active: boolean;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
};

export type TodoItem = {
  id: string;
  profile_id: string;
  recurring_todo_id: string | null;
  title: string;
  is_completed: boolean;
  completed_at: string | null;
  due_date: string | null;
  created_at: string;
  updated_at: string;
};

export type RecurringTodoItem = {
  id: string;
  profile_id: string;
  title: string;
  frequency: RecurringTodoFrequency;
  weekly_days: number[];
  monthly_day: number | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type Database = {
  public: {
    Tables: {
      profiles: {
        Row: Profile;
        Insert: Pick<Profile, 'id' | 'email' | 'full_name'> & {
          nickname?: string | null;
          phone?: string | null;
          gender?: string | null;
          birthday?: string | null;
          identity_number?: string | null;
          avatar_url?: string | null;
          review_note?: string | null;
          reviewed_by?: string | null;
          reviewed_at?: string | null;
          region_id?: string | null;
          can_view_all_regions?: boolean;
          created_at?: string;
          updated_at?: string;
          role?: AppRole;
          status?: ProfileStatus;
        };
        Update: Partial<Omit<Profile, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      regions: {
        Row: Region;
        Insert: Partial<Pick<Region, 'id' | 'company_english_name' | 'company_registration_no' | 'company_instagram' | 'company_facebook' | 'is_active' | 'sort_order' | 'created_at' | 'updated_at'>> &
          Pick<Region, 'code' | 'name'>;
        Update: Partial<Omit<Region, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      employment_types: {
        Row: EmploymentType;
        Insert: Partial<Pick<EmploymentType, 'id' | 'is_active' | 'sort_order' | 'created_at' | 'updated_at'>> &
          Pick<EmploymentType, 'name'>;
        Update: Partial<Omit<EmploymentType, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      job_titles: {
        Row: JobTitle;
        Insert: Partial<Pick<JobTitle, 'id' | 'is_active' | 'sort_order' | 'created_at' | 'updated_at'>> &
          Pick<JobTitle, 'name'>;
        Update: Partial<Omit<JobTitle, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      employees: {
        Row: Employee;
        Insert: Partial<Pick<Employee, 'id' | 'employee_code' | 'nickname' | 'avatar_url' | 'email' | 'phone' | 'gender' | 'birthday' | 'identity_number' | 'address' | 'emergency_contact_name' | 'emergency_contact_phone' | 'emergency_contact_relationship' | 'bank_name' | 'bank_account' | 'bank_account_name' | 'base_salary' | 'region_id' | 'employment_type_id' | 'job_title_id' | 'status' | 'hire_date' | 'reviewed_by' | 'reviewed_at' | 'deleted_at' | 'created_at' | 'updated_at'>> &
          Pick<Employee, 'full_name'> & {
            profile_id?: string | null;
            start_work_time?: string | null;
            end_work_time?: string | null;
            require_attendance?: boolean;
          };
        Update: Partial<Omit<Employee, 'id' | 'created_at' | 'updated_at' | 'probation_confirm_date'>>;
        Relationships: [
          {
            foreignKeyName: 'employees_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employees_employment_type_id_fkey';
            columns: ['employment_type_id'];
            isOneToOne: false;
            referencedRelation: 'employment_types';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'employees_job_title_id_fkey';
            columns: ['job_title_id'];
            isOneToOne: false;
            referencedRelation: 'job_titles';
            referencedColumns: ['id'];
          },
        ];
      };
      leave_requests: {
        Row: LeaveRequest;
        Insert: Pick<LeaveRequest, 'profile_id' | 'leave_type' | 'start_date' | 'end_date' | 'reason'> &
          Partial<Pick<LeaveRequest, 'id' | 'employee_id' | 'medical_attachment_url' | 'status' | 'review_note' | 'reviewed_by' | 'reviewed_at' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<LeaveRequest, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'leave_requests_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'leave_requests_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      attendance_records: {
        Row: AttendanceRecord;
        Insert: Pick<AttendanceRecord, 'profile_id' | 'punch_type' | 'photo_path' | 'latitude' | 'longitude' | 'device_info'> &
          Partial<Pick<AttendanceRecord, 'id' | 'employee_id' | 'punched_at' | 'accuracy' | 'ip_address' | 'break_minutes' | 'overtime_minutes' | 'is_abnormal' | 'abnormal_types' | 'attendance_location_id' | 'distance_meters' | 'location_check_result' | 'created_at'>>;
        Update: Partial<Omit<AttendanceRecord, 'id' | 'created_at'>>;
        Relationships: [
          {
            foreignKeyName: 'attendance_records_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attendance_records_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attendance_records_attendance_location_id_fkey';
            columns: ['attendance_location_id'];
            isOneToOne: false;
            referencedRelation: 'attendance_locations';
            referencedColumns: ['id'];
          },
        ];
      };
      attendance_locations: {
        Row: AttendanceLocation;
        Insert: Pick<AttendanceLocation, 'region_id' | 'name' | 'latitude' | 'longitude'> &
          Partial<Pick<AttendanceLocation, 'id' | 'radius_meters' | 'is_active' | 'created_by' | 'updated_by' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<AttendanceLocation, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'attendance_locations_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attendance_locations_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'attendance_locations_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      shifts: {
        Row: Shift;
        Insert: Partial<Pick<Shift, 'id' | 'break_minutes' | 'is_active' | 'created_at' | 'updated_at'>> &
          Pick<Shift, 'name' | 'start_time' | 'end_time'>;
        Update: Partial<Omit<Shift, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [];
      };
      schedule_entries: {
        Row: ScheduleEntry;
        Insert: Pick<ScheduleEntry, 'employee_id' | 'work_date'> &
          Partial<Pick<ScheduleEntry, 'id' | 'shift_id' | 'is_day_off' | 'note' | 'created_by' | 'updated_by' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<ScheduleEntry, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'schedule_entries_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'schedule_entries_shift_id_fkey';
            columns: ['shift_id'];
            isOneToOne: false;
            referencedRelation: 'shifts';
            referencedColumns: ['id'];
          },
        ];
      };
      rest_days: {
        Row: RestDay;
        Insert: Pick<RestDay, 'employee_id' | 'profile_id' | 'rest_date' | 'cycle_year' | 'cycle_month'> &
          Partial<Pick<RestDay, 'id' | 'region_id' | 'source' | 'status' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<RestDay, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'rest_days_employee_id_fkey';
            columns: ['employee_id'];
            isOneToOne: false;
            referencedRelation: 'employees';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'rest_days_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      schedule_events: {
        Row: ScheduleEvent;
        Insert: Pick<ScheduleEvent, 'profile_id' | 'title' | 'event_date'> &
          Partial<Pick<ScheduleEvent, 'id' | 'start_time' | 'end_time' | 'location' | 'note' | 'event_type' | 'status' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<ScheduleEvent, 'id' | 'profile_id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'schedule_events_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      public_holidays: {
        Row: PublicHoliday;
        Insert: Pick<PublicHoliday, 'holiday_name' | 'holiday_date'> &
          Partial<Pick<PublicHoliday, 'id' | 'region_id' | 'note' | 'is_active' | 'created_by' | 'updated_by' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<PublicHoliday, 'id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'public_holidays_region_id_fkey';
            columns: ['region_id'];
            isOneToOne: false;
            referencedRelation: 'regions';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'public_holidays_created_by_fkey';
            columns: ['created_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
          {
            foreignKeyName: 'public_holidays_updated_by_fkey';
            columns: ['updated_by'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      todo_items: {
        Row: TodoItem;
        Insert: Pick<TodoItem, 'profile_id' | 'title'> &
          Partial<Pick<TodoItem, 'id' | 'recurring_todo_id' | 'is_completed' | 'completed_at' | 'due_date' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<TodoItem, 'id' | 'profile_id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'todo_items_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
      recurring_todo_items: {
        Row: RecurringTodoItem;
        Insert: Pick<RecurringTodoItem, 'profile_id' | 'title' | 'frequency'> &
          Partial<Pick<RecurringTodoItem, 'id' | 'weekly_days' | 'monthly_day' | 'is_active' | 'created_at' | 'updated_at'>>;
        Update: Partial<Omit<RecurringTodoItem, 'id' | 'profile_id' | 'created_at' | 'updated_at'>>;
        Relationships: [
          {
            foreignKeyName: 'recurring_todo_items_profile_id_fkey';
            columns: ['profile_id'];
            isOneToOne: false;
            referencedRelation: 'profiles';
            referencedColumns: ['id'];
          },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      approve_leave_request: {
        Args: {
          request_id: string;
        };
        Returns: void;
      };
      approve_registration: {
        Args: {
          profile_id: string;
        };
        Returns: void;
      };
      approve_registration_with_employee: {
        Args: {
          profile_id: string;
          employment_type_id: string;
          job_title_id: string;
          employee_status: EmployeeStatus;
          hire_date: string;
          start_work_time: string;
          end_work_time: string;
          require_attendance: boolean;
          base_salary?: number | null;
        };
        Returns: void;
      };
      auto_confirm_probation_employees: {
        Args: Record<string, never>;
        Returns: number;
      };
      reject_registration: {
        Args: {
          profile_id: string;
          note: string;
        };
        Returns: void;
      };
      reject_leave_request: {
        Args: {
          request_id: string;
          note: string;
        };
        Returns: void;
      };
      get_leave_calendar: {
        Args: {
          month_start: string;
          month_end: string;
          region_filter?: string | null;
        };
        Returns: {
          leave_request_id: string;
          employee_id: string;
          employee_name: string;
          employee_code: string | null;
          region_id: string | null;
          region_code: string | null;
          leave_type: LeaveType;
          start_date: string;
          end_date: string;
          leave_date: string;
          applicant_name: string | null;
          reviewer_name: string | null;
          reviewed_at: string | null;
        }[];
      };
      get_rest_day_calendar: {
        Args: {
          cycle_year: number;
          cycle_month: number;
          region_filter?: string | null;
        };
        Returns: {
          rest_day_id: string;
          employee_id: string;
          profile_id: string;
          employee_name: string;
          employee_code: string | null;
          region_id: string | null;
          region_code: string | null;
          rest_date: string;
          source: 'manual' | 'auto';
          status: 'confirmed' | 'cancelled';
        }[];
      };
      save_my_rest_days: {
        Args: {
          cycle_year: number;
          cycle_month: number;
          rest_dates: string[];
        };
        Returns: number;
      };
      auto_fill_rest_days: {
        Args: {
          cycle_year: number;
          cycle_month: number;
          region_filter?: string | null;
        };
        Returns: number;
      };
      current_user_can_cancel_calendar_leave: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      calculate_distance_meters: {
        Args: {
          lat1: number;
          lon1: number;
          lat2: number;
          lon2: number;
        };
        Returns: number;
      };
      create_attendance_record_checked: {
        Args: {
          p_punch_type: AttendancePunchType;
          p_photo_path: string;
          p_latitude: number;
          p_longitude: number;
          p_accuracy: number | null;
          p_ip_address: string | null;
          p_device_info: string;
        };
        Returns: string;
      };
      cancel_calendar_leave_item: {
        Args: {
          item_id: string;
          item_type: string;
          cancel_reason?: string | null;
        };
        Returns: void;
      };
      soft_delete_employee: {
        Args: {
          employee_id: string;
        };
        Returns: void;
      };
    };
    Enums: {
      profile_status: ProfileStatus;
      employee_status: EmployeeStatus;
      app_role: AppRole;
      leave_type: LeaveType;
      leave_request_status: LeaveRequestStatus;
      attendance_punch_type: AttendancePunchType;
    };
    CompositeTypes: Record<string, never>;
  };
};
