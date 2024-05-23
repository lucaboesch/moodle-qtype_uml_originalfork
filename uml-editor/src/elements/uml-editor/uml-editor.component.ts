import {
  AfterViewInit,
  booleanAttribute,
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  inject,
  Input,
  OnChanges,
  Output,
  signal,
  SimpleChanges,
  ViewChild,
  ViewContainerRef,
} from '@angular/core'
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop'
import { FormControl } from '@angular/forms'
import { MatButtonModule } from '@angular/material/button'
import { MatIconModule } from '@angular/material/icon'
import { MatSidenavModule } from '@angular/material/sidenav'
import { MatSnackBar } from '@angular/material/snack-bar'
import { MatTooltip } from '@angular/material/tooltip'
import { dia } from '@joint/core'
import { debounceTime, map } from 'rxjs'
import { CustomJointJSElementAttributes } from '../../models/jointjs/custom-jointjs-element.model'
import { EMPTY_DIAGRAM, EMPTY_DIAGRAM_OBJECT, JointJSDiagram } from '../../models/jointjs/jointjs-diagram.model'
import { LinkConfigurationComponent } from '../../shared/link-configuration/link-configuration.component'
import { PropertyEditorService } from '../../shared/property-editor/property-editor.service'
import { UmlEditorToolboxComponent } from '../../shared/uml-editor-toolbox/uml-editor-toolbox.component'
import { initCustomNamespaceGraph, initCustomPaper } from '../../utils/jointjs-drawer.utils'
import { jointJSCustomUmlElements } from '../../utils/jointjs-extension.const'
import { decodeDiagram, encodeDiagram } from '../../utils/uml-editor-compression.utils'

@Component({
  selector: 'app-uml-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './uml-editor.component.html',
  styleUrl: './uml-editor.component.scss',
  imports: [MatSidenavModule, MatButtonModule, MatIconModule, UmlEditorToolboxComponent, MatTooltip],
})
export class UmlEditorComponent implements OnChanges, AfterViewInit {
  @Input({ transform: booleanAttribute }) allowEdit = false
  @Input() inputId: string | null = null
  @Input() diagram: string | null = null

  @ViewChild('editor', { static: true }) protected editorRef!: ElementRef<HTMLDivElement>

  @Output() protected readonly diagramChanged = new EventEmitter<{
    inputId: string
    diagram: string
  }>()

  protected readonly diagramControl = new FormControl<JointJSDiagram>(EMPTY_DIAGRAM_OBJECT, { nonNullable: true })
  protected readonly isDirty = toSignal(this.diagramControl.valueChanges.pipe(map(() => this.diagramControl.dirty)))

  private readonly viewContainerRef = inject(ViewContainerRef)
  private readonly showPropertyEditorService = inject(PropertyEditorService)
  private readonly snackbar = inject(MatSnackBar)

  private readonly _paperEditor = signal<dia.Paper | null>(null)

  constructor() {
    // listen to diagram changes and emit value
    this.diagramControl.valueChanges.pipe(takeUntilDestroyed(), debounceTime(200)).subscribe(this.encodeAndEmitDiagram)
  }

  ngOnChanges(changes: SimpleChanges) {
    if (('diagram' satisfies keyof this) in changes) {
      this.setDiagramToEditor(this.diagram, { emitEvent: false })
    }
  }

  ngAfterViewInit() {
    const graph = initCustomNamespaceGraph()

    const paperEditor = initCustomPaper(this.editorRef.nativeElement, graph)

    graph.on('change', () => {
      this.diagramControl.markAsDirty()
      this.diagramControl.setValue(graph.toJSON())
    })

    graph.on('add', () => {
      this.diagramControl.markAsDirty()
      this.diagramControl.setValue(graph.toJSON())
    })

    paperEditor.on('cell:pointerdblclick', cell => {
      this.showPropertyEditorService.hide()

      // handle generic link from jointjs
      if (cell instanceof dia.LinkView) {
        this.showPropertyEditorService.show(this.viewContainerRef, LinkConfigurationComponent, { model: cell.model })
        return
      }

      // handle custom elements
      if (cell instanceof dia.ElementView) {
        const propertyKey = 'propertyView' satisfies keyof CustomJointJSElementAttributes<dia.Element.Attributes>
        if (propertyKey in cell.model.attributes && cell.model.attributes[propertyKey]) {
          this.showPropertyEditorService.show(this.viewContainerRef, cell.model.attributes[propertyKey], {
            model: cell.model,
            elementView: cell,
          })
        }
      }
    })

    this._paperEditor.set(paperEditor)

    this.setDiagramToEditor(this.diagram, { emitEvent: false })
  }

  protected addItemFromToolboxToEditor(itemType: string) {
    const clickedClass = jointJSCustomUmlElements.find(item => item.defaults.type === itemType)?.instance.clone()
    if (!clickedClass) {
      throw new Error(`itemType ${itemType} not found`)
    }

    const tmpX = Math.floor(Math.random() * (500 - 20 + 1)) + 20
    const tmpY = Math.floor(Math.random() * (500 - 20 + 1)) + 20
    clickedClass.position(tmpX, tmpY)

    this._paperEditor()?.model.addCell(clickedClass)
  }

  protected resetDiagram() {
    this.setDiagramToEditor(this.diagram || EMPTY_DIAGRAM)
  }

  protected copyDiagramToClipboard(event: ClipboardEvent) {
    event.preventDefault()
    event.stopPropagation()

    const encodedDiagram = encodeDiagram(this.diagramControl.value)
    event.clipboardData?.setData('text/plain', encodedDiagram)

    this.snackbar.open('Diagram copied to clipboard', 'Dismiss', {
      duration: 2000,
    })
  }

  protected pasteDiagramFromClipboard(event: ClipboardEvent) {
    event.preventDefault()
    event.stopPropagation()

    const clipboardValue = event.clipboardData?.getData('text') || null
    this.setDiagramToEditor(clipboardValue, { emitEvent: true })

    this.snackbar.open('Diagram pasted from clipboard', 'Dismiss', {
      duration: 2000,
    })
  }

  private readonly setDiagramToEditor = (
    diagramValue: string | null,
    options?: {
      onlySelf?: boolean
      emitEvent?: boolean
    }
  ) => {
    const paperEditor = this._paperEditor()
    if (!diagramValue || !paperEditor) {
      return
    }

    const decoded = decodeDiagram(diagramValue)
    try {
      paperEditor.model.fromJSON(decoded)
      this.diagramControl.reset(decoded, options)
    } catch (err) {
      console.error('error while decoding diagram', err, diagramValue)
      paperEditor.model.clear()
    }
  }

  private readonly encodeAndEmitDiagram = (diagram: JointJSDiagram) => {
    // the value was changed
    const inputId = this.inputId
    if (!inputId || !diagram) {
      console.warn('inputId or diagram not set')
      return
    }

    const encodedDiagram = encodeDiagram(diagram)
    console.debug('diagram changed', inputId, encodedDiagram)

    this.diagramChanged.emit({
      inputId,
      diagram: encodedDiagram,
    })
  }
}
