import { ChangeDetectionStrategy, Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ws-role-hierarchy-visualizer',
  imports: [CommonModule],
  template: `<p>RoleHierarchyVisualizer works!</p>`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RoleHierarchyVisualizerComponent {}
