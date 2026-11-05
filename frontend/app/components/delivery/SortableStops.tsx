'use client';

import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { CSSProperties, MouseEvent, ReactNode, TouchEvent } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  type CollisionDetection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragMoveEvent,
  type Modifier,
  type MouseSensorOptions,
  type TouchSensorOptions,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical } from 'lucide-react';

// A stop card holds buttons, links and forms, and on a computer its text can be
// selected. So a mouse drags by the grip only; a finger can press and hold
// anywhere that isn't one of those controls.
const NOT_DRAGGABLE =
  'button:not([data-drag-handle]), a, input, select, textarea, label, img, [data-no-map-focus]';

function startsOnCard(event: { target: EventTarget; currentTarget: EventTarget }) {
  const target = event.target as Element;
  // React events bubble out of portals, so a date picker's popup reaches here too.
  return (event.currentTarget as Element).contains(target) && !target.closest(NOT_DRAGGABLE);
}

function startsOnGrip(event: { target: EventTarget; currentTarget: EventTarget }) {
  const target = event.target as Element;
  return (event.currentTarget as Element).contains(target) && !!target.closest('[data-drag-handle]');
}

class CardMouseSensor extends MouseSensor {
  static activators = [
    {
      eventName: 'onMouseDown' as const,
      handler: (event: MouseEvent, options: MouseSensorOptions) =>
        startsOnGrip(event) && MouseSensor.activators[0].handler(event, options),
    },
  ];
}

class CardTouchSensor extends TouchSensor {
  static activators = [
    {
      eventName: 'onTouchStart' as const,
      handler: (event: TouchEvent, options: TouchSensorOptions) =>
        startsOnCard(event) && TouchSensor.activators[0].handler(event, options),
    },
  ];
}

const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

// How long the reason stays on the card after a refused drop.
const REFUSED_MESSAGE_MS = 4000;

export function shakeCard(id: string) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  // `translate`, not `transform`: the drag itself is using transform.
  document.querySelector(`[data-stop-card="${id}"]`)?.animate(
    [0, -7, 7, -5, 5, -2, 0].map((x) => ({ translate: `${x}px 0` })),
    { duration: 400, easing: 'ease-in-out' },
  );
}

// The card showing "you can't put this here": being dragged there, or just dropped there.
const RefusedCardContext = createContext<string | null>(null);

export function SortableStops({
  ids,
  onReorder,
  isValidOrder,
  children,
}: {
  // Only the cards that can move, in order. Others are pinned where they are.
  ids: string[];
  onReorder: (ids: string[]) => void;
  isValidOrder: (ids: string[]) => boolean;
  children: ReactNode;
}) {
  const [blockedId, setBlockedId] = useState<string | null>(null);
  const [refusedId, setRefusedId] = useState<string | null>(null);
  // Set during collision detection, which runs in the middle of a render.
  const pastLimit = useRef(false);
  const refusedTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(refusedTimer.current), []);

  const sensors = useSensors(
    // The distance lets a plain click through; it still opens the stop on the map.
    useSensor(CardMouseSensor, { activationConstraint: { distance: 6 } }),
    // Press and hold on touch, so swiping over the cards still scrolls the page.
    useSensor(CardTouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // A card can only take a place the rule allows, so cards past that limit never
  // shift to make room. Whether it's being pulled past the limit is still noted,
  // to refuse it.
  const collisionDetection: CollisionDetection = (args) => {
    const from = ids.indexOf(String(args.active.id));
    const allowed = (id: unknown) => {
      const to = ids.indexOf(String(id));
      return to >= 0 && isValidOrder(arrayMove(ids, from, to));
    };
    const nearestId = closestCenter(args)[0]?.id;
    pastLimit.current = nearestId != null && !allowed(nearestId);
    return closestCenter({
      ...args,
      droppableContainers: args.droppableContainers.filter((c) => allowed(c.id)),
    });
  };

  function handleDragStart() {
    clearTimeout(refusedTimer.current);
    setRefusedId(null);
    pastLimit.current = false;
  }

  function handleDragMove({ active }: DragMoveEvent) {
    const id = String(active.id);
    const next = pastLimit.current ? id : null;
    if (next === blockedId) return;
    setBlockedId(next);
    if (next) shakeCard(id);
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    setBlockedId(null);
    if (pastLimit.current) {
      const id = String(active.id);
      shakeCard(id);
      setRefusedId(id);
      refusedTimer.current = setTimeout(() => setRefusedId(null), REFUSED_MESSAGE_MS);
      return;
    }
    if (!over || active.id === over.id) return;
    onReorder(arrayMove(ids, ids.indexOf(String(active.id)), ids.indexOf(String(over.id))));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={collisionDetection}
      modifiers={[verticalOnly]}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setBlockedId(null)}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <RefusedCardContext.Provider value={blockedId ?? refusedId}>{children}</RefusedCardContext.Provider>
      </SortableContext>
    </DndContext>
  );
}

// `children` receives the grip to place in the card; null when it can't be moved.
export function SortableStopCard({
  id,
  enabled,
  refused: refusedFromOutside = false,
  handleLabel,
  refusedMessage,
  className,
  onClick,
  children,
}: {
  id: string;
  enabled: boolean;
  // For a move refused by something other than dragging (the up/down buttons).
  refused?: boolean;
  handleLabel: string;
  refusedMessage: string;
  className: string;
  onClick: (event: MouseEvent<HTMLDivElement>) => void;
  children: (handle: ReactNode) => ReactNode;
}) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !enabled });
  const refused = useContext(RefusedCardContext) === id || refusedFromOutside;

  // Translate, not Transform: cards differ in height and must not stretch.
  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition };

  const handle = enabled ? (
    <button
      type="button"
      ref={setActivatorNodeRef}
      {...attributes}
      data-drag-handle
      aria-label={handleLabel}
      title={handleLabel}
      className="touch-none cursor-grab active:cursor-grabbing text-gray-400 hover:text-gray-600 rounded p-1 -m-1"
    >
      <GripVertical size={16} />
    </button>
  ) : null;

  return (
    <div
      ref={setNodeRef}
      data-stop-card={id}
      style={style}
      {...listeners}
      onClick={onClick}
      className={`${className} ${enabled ? '[@media(pointer:coarse)]:select-none' : ''} ${isDragging ? 'relative z-20 shadow-lg' : ''} ${refused ? 'relative !border-red-500 ring-2 ring-red-300' : ''}`}
    >
      {refused && (
        <div
          role="alert"
          className="pointer-events-none absolute -top-3 right-2 z-30 max-w-[calc(100%-1rem)] rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white shadow"
        >
          {refusedMessage}
        </div>
      )}
      {children(handle)}
    </div>
  );
}
