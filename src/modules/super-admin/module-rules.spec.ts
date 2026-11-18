import { checkModuleChange, ModuleInfo } from './module-rules';

const academic: ModuleInfo = { key: 'academic', name: 'Academic', dependsOn: [] };
const students: ModuleInfo = { key: 'students', name: 'Students', dependsOn: ['academic'] };
const attendance: ModuleInfo = {
  key: 'attendance',
  name: 'Attendance',
  dependsOn: ['academic', 'students'],
};
const all = [academic, students, attendance];

describe('checkModuleChange', () => {
  it('allows switching on a module whose dependencies are on', () => {
    expect(checkModuleChange(students, true, all, ['academic'])).toBeNull();
  });

  it('refuses switching on a module before its dependencies', () => {
    expect(checkModuleChange(attendance, true, all, ['academic'])).toBe(
      'Attendance needs these modules first: students',
    );
  });

  it('refuses switching off a module another module still needs', () => {
    expect(checkModuleChange(students, false, all, ['academic', 'students', 'attendance'])).toBe(
      'Switch off these modules first: Attendance',
    );
  });

  it('allows switching off a module nothing depends on', () => {
    expect(
      checkModuleChange(attendance, false, all, ['academic', 'students', 'attendance']),
    ).toBeNull();
  });
});
