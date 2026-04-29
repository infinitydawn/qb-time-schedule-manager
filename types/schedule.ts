export interface WorkerAssignment {
  id: string;
  workers: string[];
  job: string;
  pmId: string;
  startTime?: string;
  endTime?: string;
  qbEventId?: string;
  assignmentHash?: string;
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
  qbHash?: string;
  createdAt?: string;
  updatedAt?: string;
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
