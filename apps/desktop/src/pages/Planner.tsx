import { useState } from 'react';
import type { PageProps } from '../App';
import { PageHeader, Segmented } from '../components/ui';
import { DailyPlanner } from '../components/planner/DailyPlanner';
import { CalendarView } from '../components/planner/CalendarView';
import { StudyPlanner } from '../components/planner/StudyPlanner';

type Tab = 'day' | 'calendar' | 'study';

export default function Planner(_: PageProps) {
  const [tab, setTab] = useState<Tab>('day');
  return (
    <>
      <PageHeader
        title="Planner"
        subtitle="Plan the day, see the week, track your studies."
        actions={
          <Segmented
            label="Planner view"
            value={tab}
            onChange={setTab}
            options={[
              { value: 'day', label: 'Daily plan' },
              { value: 'calendar', label: 'Calendar' },
              { value: 'study', label: 'Study' },
            ]}
          />
        }
      />
      {tab === 'day' && <DailyPlanner />}
      {tab === 'calendar' && <CalendarView />}
      {tab === 'study' && <StudyPlanner />}
    </>
  );
}
