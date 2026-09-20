/**
 * Custom class CRUD operations — built from the shared SupabaseDataCtx.
 * Extracted from useSupabaseData.ts during the per-domain split.
 */
import { supabase } from '../supabaseClient';
import type { SupabaseDataCtx } from '../dataOpsContext';
import type { ClassCycle, CustomClass } from '../domainTypes';
import { createRowId } from '../rowMappers';

export function createClassOps(ctx: SupabaseDataCtx) {
  const { setCustomClasses, notifySuccess, notifyError, isOffline, enqueueOffline } = ctx;

  const addCustomClass = async (cls: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }): Promise<CustomClass | null> => {
    const code = cls.code.trim().replace(/\s+/g, ' ');
    if (!code) return null;
    // Hors ligne : la classe est créée sur le poste et part en file. Son `rowId`
    // est un UUID choisi ICI (createRowId) et envoyé à l'insertion — la même
    // règle que pour un élève : la classe garde, dans la base, l'identifiant que
    // les gestes suivants (modification, suppression) désignent déjà.
    if (isOffline()) {
      const rowId = createRowId();
      const local: CustomClass = {
        id: code,
        rowId,
        cycle: cls.cycle,
        year: cls.year,
        section: cls.section,
        nameFr: cls.nameFr,
        nameEn: cls.nameEn,
        isCustom: true,
      };
      // Le code est unique (insensible à la casse) dans la table : la liste de
      // l'écran applique la même règle, sinon la classe s'y afficherait deux fois.
      setCustomClasses(prev => prev.some(c => c.id.toLowerCase() === code.toLowerCase()) ? prev : [...prev, local]);
      enqueueOffline('addClass', { ...cls, code }, rowId);
      notifySuccess('addCustomClass');
      return local;
    }
    const { data, error } = await supabase
      .from('custom_classes')
      .insert({
        code,
        cycle: cls.cycle,
        year: cls.year,
        section: cls.section,
        name_fr: cls.nameFr,
        name_en: cls.nameEn,
      })
      .select()
      .single();
    if (error) {
      if (error.code === '23505') {
        const { data: existingRow } = await supabase
          .from('custom_classes')
          .select('*')
          .ilike('code', code)
          .maybeSingle();
        if (existingRow) {
          const existing: CustomClass = {
            id: existingRow.code,
            rowId: existingRow.id,
            cycle: existingRow.cycle as ClassCycle,
            year: existingRow.year,
            section: existingRow.section,
            nameFr: existingRow.name_fr,
            nameEn: existingRow.name_en,
            isCustom: true,
          };
          setCustomClasses(prev => prev.some(c => c.id === existing.id) ? prev : [...prev, existing]);
          return existing;
        }
      }
      notifyError('addCustomClass', error.message);
      return null;
    }
    const newClass: CustomClass = {
      id: data.code,
      rowId: data.id,
      cycle: data.cycle as ClassCycle,
      year: data.year,
      section: data.section,
      nameFr: data.name_fr,
      nameEn: data.name_en,
      isCustom: true,
    };
    setCustomClasses(prev => [...prev, newClass]);
    return newClass;
  };

  const updateCustomClass = async (rowId: string, updates: {
    code: string;
    cycle: ClassCycle;
    year: string;
    section: string;
    nameFr: string;
    nameEn: string;
  }): Promise<boolean> => {
    const code = updates.code.trim().replace(/\s+/g, ' ');
    if (!code) return false;
    if (isOffline()) {
      setCustomClasses(prev => prev.map(c => c.rowId === rowId
        ? { ...c, id: code, cycle: updates.cycle, year: updates.year, section: updates.section, nameFr: updates.nameFr, nameEn: updates.nameEn }
        : c));
      enqueueOffline('updateClass', { id: rowId, updates: { ...updates, code } });
      notifySuccess('updateCustomClass');
      return true;
    }
    const { data: updated, error } = await supabase
      .from('custom_classes')
      .update({
        code,
        cycle: updates.cycle,
        year: updates.year,
        section: updates.section,
        name_fr: updates.nameFr,
        name_en: updates.nameEn,
      })
      .eq('id', rowId)
      .select('id');
    if (error) {
      if (error.code === '23505') {
        notifyError('updateCustomClass', 'A class with this code already exists.');
        return false;
      }
      notifyError('updateCustomClass', error.message);
      return false;
    }
    // Même règle honnête que staff/students/parents : une requête filtrée par la
    // policy RLS revient en 200 avec un corps VIDE — 0 ligne n'est pas un succès.
    if (!updated || updated.length === 0) {
      notifyError('updateCustomClass', 'Aucune ligne modifiée — droits insuffisants sur cette classe.');
      return false;
    }
    setCustomClasses(prev => prev.map(c => c.rowId === rowId
      ? { ...c, id: code, cycle: updates.cycle, year: updates.year, section: updates.section, nameFr: updates.nameFr, nameEn: updates.nameEn }
      : c));
    notifySuccess('updateCustomClass');
    return true;
  };

  const deleteCustomClass = async (rowId: string): Promise<boolean> => {
    if (isOffline()) {
      setCustomClasses(prev => prev.filter(c => c.rowId !== rowId));
      enqueueOffline('deleteClass', { id: rowId });
      notifySuccess('deleteCustomClass');
      return true;
    }
    const { data, error } = await supabase
      .from('custom_classes')
      .delete()
      .eq('id', rowId)
      .select('id');
    if (error) {
      notifyError('deleteCustomClass', error.message);
      return false;
    }
    // Même règle honnête que staff/students/parents : 0 ligne n'est pas un succès.
    if (!data || data.length === 0) {
      notifyError('deleteCustomClass', 'Aucune ligne supprimée — droits insuffisants sur cette classe.');
      return false;
    }
    setCustomClasses(prev => prev.filter(c => c.rowId !== rowId));
    notifySuccess('deleteCustomClass');
    return true;
  };

  return { addCustomClass, updateCustomClass, deleteCustomClass };
}