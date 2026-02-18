export interface WorkerAssignment {
  id: string;
  workers: string[];
  job: string;
  pmId: string;
}

export interface ProjectManager {
  id: string;
  name: string;
  assignments: WorkerAssignment[];
}

export interface DailySchedule {
  id: string;
  date: string;
  dayName: string;
  projectManagers: ProjectManager[];
  sentToQB?: boolean;
}

export interface Employee {
  id: string;
  name: string;
  qbTimeId?: string;
  active: boolean;
}

export interface QBTimeEntry {
  employeeName: string;
  date: string;
  hours: number;
  job: string;
  projectManager: string;
  jobCode?: string;
}

// QB Time API types
export interface QBTimeEmployee {
  id: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email?: string;
}

export interface QBTimeCompany {
  id: string;
  name: string;
}