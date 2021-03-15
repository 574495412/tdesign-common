import uniqueId from 'lodash/uniqueId';
import { TreeStore } from './tree-store';
import {
  TreeNodeValue,
  TreeNodeState,
  TypeIdMap,
  TypeTreeItem,
  TypeSettingOptions,
  TypeTreeNodeModel,
  TypeTreeNodeData,
} from './types';

const { hasOwnProperty } = Object.prototype;

const defaultStatus = {
  expandMutex: false,
  activable: false,
  checkable: false,
  disabled: false,
  draggable: false,
  loading: false,
};

// vm 开头为视图属性，不可以外部设置
// 用于触发视图更新
export class TreeNode {
  // 节点隶属的树实例
  public tree: TreeStore;
  // 节点 id ，唯一标志
  public value: string;
  // 节点文本
  public label: string;
  // 节点数据
  public dataset: TypeTreeNodeData;
  // 父节点
  public parent: TreeNode;
  // 子节点列表
  public children: TreeNode[] | boolean;
  // 是否为叶节点
  public vmIsLeaf: boolean;
  // 是否为子节点中的第一个
  public vmIsFirst: boolean;
  // 是否为子节点中的最后
  public vmIsLast: boolean;
  // 节点在视图上实际的展开状态
  public expanded: boolean;
  // 展开时是否收起同级节点，对子节点生效
  public expandMutex: boolean;
  // 节点在视图上实际的激活状态
  public actived: boolean;
  // 是否可激活
  public activable: boolean;
  // 是否可选中
  public checkable: boolean;
  // 是否可选中的视图呈现
  public vmCheckable: boolean;
  // 节点在视图上实际的选中态
  public checked: boolean;
  // 节点实际是否为半选状态
  public indeterminate: boolean;
  // 节点是否已禁用
  public disabled: boolean;
  // 节点是否可拖动
  public draggable: boolean;
  // 节点是否可视
  public visible: boolean;
  // 节点在树中的层级
  public level: number;
  // 节点是否正在加载数据
  public loading: boolean;

  public constructor(
    tree: TreeStore,
    data?: TypeTreeNodeData,
    parent?: TreeNode,
  ) {
    this.dataset = data;
    this.tree = tree;

    const config = tree.config || {};
    const prefix = config.prefix || 't';
    const keys = tree?.config?.keys || {};
    const propChildren = keys.children || 'children';
    const propLabel = keys.label || 'label';
    const propValue = keys.value || 'value';

    this.children = null;
    this.vmCheckable = false;
    this.vmIsLeaf = false;
    this.vmIsFirst = false;
    this.vmIsLast = false;

    const spec = {
      ...defaultStatus,
      actived: false,
      expanded: false,
      checked: false,
      ...data,
    };
    const children = spec[propChildren];

    this.set(spec);
    this.label = spec[propLabel] || '';
    this.value = spec[propValue] || uniqueId(prefix);
    this.tree.nodeMap.set(this.value, this);

    if (parent && parent instanceof TreeNode) {
      this.parent = parent;
    } else {
      this.parent = null;
    }

    // 子节点为 true 的状态逻辑需要放到状态计算之前
    // 初始化加载逻辑需要依据这个来进行
    if (children === true) {
      this.children = children;
    }

    // 初始化状态计算
    this.level = 0;
    this.visible = true;

    this.actived = spec.actived;
    this.initActived();

    this.expanded = spec.expanded;
    this.initExpanded();

    this.checked = spec.checked;
    this.initChecked();

    this.update();
    tree.reflow(this);

    // 这里的子节点加载逻辑不能放到状态计算之前
    // 因为子节点状态计算依赖父节点状态
    if (Array.isArray(children)) {
      this.append(children);
    } else if (children === true && !config.lazy) {
      this.loadChildren();
    }

    // checked 状态依赖于子节点状态
    // 因此初始化状态放到子节点插入之后
    this.checked = false;
    this.indeterminate = false;
    this.updateChecked();
  }

  /* ***** 状态初始化-相关方法 ***** */
  // 初始化选中态
  public initChecked() {
    const { tree, value, parent } = this;
    let { checked } = this;
    checked = parent?.isChecked();
    if (checked) {
      tree.checkedMap.set(value, true);
    }
    this.checked = checked;
  }

  // 初始化节点展开状态
  public initExpanded(): void {
    const { tree } = this;
    let { expanded } = this;
    const { config } = tree;
    if (
      typeof config.expandLevel === 'number'
      && this.getLevel() < config.expandLevel
    ) {
      tree.expandedMap.set(this.value, true);
      expanded = true;
    }
    if (config.expandAll) {
      expanded = true;
    }
    if (this.children === true && config.lazy) {
      expanded = false;
    }
    if (expanded) {
      tree.expandedMap.set(this.value, true);
    } else {
      tree.expandedMap.delete(this.value);
    }
    this.expanded = expanded;
  }

  // 初始化高亮状态
  public initActived(): void {
    const { tree, actived } = this;
    if (actived) {
      tree.activedMap.set(this.value, true);
    }
  }

  /* ***** 节点操作-相关方法 ***** */
  // 追加数据
  public append(data: TypeTreeNodeData | TypeTreeNodeData[]): void {
    const list = [];
    if (!Array.isArray(data)) {
      list.push(data);
    } else {
      list.push(...data);
    }
    if (list.length <= 0) {
      return;
    }
    if (!Array.isArray(this.children)) {
      this.children = [];
    }
    const { children, tree } = this;
    list.forEach((item) => {
      let node = null;
      if (item instanceof TreeNode) {
        node = item;
        node.appendTo(this.tree, this);
      } else {
        node = new TreeNode(this.tree, item, this);
        children.push(node);
      }
    });
    tree.reflow(this);
    this.updateRelated();
  }

  // 将当前节点追加到某个父节点的子节点列表中
  public appendTo(
    tree: TreeStore,
    parent?: TreeNode,
    index?: number,
  ): void {
    const parentNode = parent;
    if (!parentNode) return;

    const targetParents = parentNode.getParents();
    const includeCurrent = targetParents.some(node => node.value === this.value);
    if (includeCurrent) {
      // 不能将父节点插入到子节点
      return;
    }

    if (Array.isArray(parentNode.children)) {
      let targetIndex = 0;
      if (typeof index === 'number') {
        targetIndex = index;
      }
      const targetPosNode = parentNode.children[targetIndex];
      if (targetPosNode.value === this.value) {
        // 无需将节点插入到原位置
        return;
      }
    }

    this.remove();
    this.parent = parentNode;

    let siblings = null;
    if (parentNode instanceof TreeNode) {
      if (!Array.isArray(parentNode.children)) {
        parentNode.children = [];
      }
      siblings = parent.children;
    } else {
      siblings = tree.children;
    }
    if (Array.isArray(siblings)) {
      if (typeof index === 'number') {
        siblings.splice(index, 0, this);
      } else {
        siblings.push(this);
      }
    }

    // 插入节点应当继承展开状态
    // 但建议不要继承选中状态和高亮状态
    const nodes = this.walk();
    nodes.forEach((item) => {
      const node = item;
      node.tree = tree;
      tree.nodeMap.set(node.value, node);
      if (node.expanded) {
        tree.expandedMap.set(node.value, true);
      }
    });

    const updateNodes = parentNode.walk();
    updateNodes.forEach((node) => {
      node.update();
      node.updateChecked();
    });

    tree.reflow();
  }

  // 插入一个同级节点数据
  public insert(
    item: TypeTreeItem,
    index?: number,
  ): void {
    const { tree, parent } = this;
    const siblings = this.getSiblings();
    let node = null;
    if (item instanceof TreeNode) {
      node = item;
      node.appendTo(tree, parent, index);
    } else if (item) {
      node = new TreeNode(tree, item, parent);
      if (typeof index === 'number') {
        siblings.splice(index, 0, node);
      }
      siblings.forEach((node) => {
        node.update();
      });
    }
    tree.reflow();
  }

  // 在当前节点之前插入节点
  public insertBefore(newData: TypeTreeItem): void {
    const index = this.getIndex();
    this.insert(newData, index);
  }

  // 在当前节点之后插入节点
  public insertAfter(newData: TypeTreeItem): void {
    const index = this.getIndex();
    this.insert(newData, index + 1);
  }

  // 从一个树移除本节点
  public remove(): void {
    const { tree } = this;

    const nodes = this.walk();
    const siblings = this.getSiblings();
    const index = this.getIndex();
    // 从父节点的子节点列表中移除自己
    // 但不要将自己的父节点移除，避免渲染与判断失败
    if (Array.isArray(siblings)) {
      siblings.splice(index, 1);
    }
    // 清理与树的关系，但不清理自身状态
    nodes.forEach((node) => {
      node.clean();
    });
    // 同级节点的连线状态会受到影响
    siblings.forEach((node) => {
      node.update();
    });
    // 父节点选中态会受到影响
    this.updateParents();
    tree.reflow();
  }

  // 清除本节点与一个树的关系
  public clean(): void {
    const { tree, value } = this;
    tree.activedMap.delete(value);
    tree.checkedMap.delete(value);
    tree.expandedMap.delete(value);
    tree.nodeMap.delete(value);
  }

  // 异步加载子节点数据
  public async loadChildren(): Promise<void> {
    const config = this?.tree?.config || {};
    if (this.children === true && !this.loading) {
      if (typeof config.load === 'function') {
        this.loading = true;
        this.update();
        let list = [];
        list = await config.load(this);
        this.tree.emit('load', {
          node: this,
          data: list,
        });
        this.loading = false;
        if (Array.isArray(list) && list.length > 0) {
          this.append(list);
        } else {
          this.children = false;
        }
        this.update();
      }
    }
  }

  // 设置状态
  public set(item: TreeNodeState): void {
    const { tree } = this;
    const keys = Object.keys(item);
    keys.forEach((key) => {
      if (hasOwnProperty.call(defaultStatus, key) || key === 'label') {
        this[key] = item[key];
      }
    });
    tree.updated(this);
  }

  /* ***** 节点获取-相关方法 ***** */
  // 获取单个父节点
  public getParent(): TreeNode {
    return this.parent;
  }

  // 获取所有父节点
  public getParents(): TreeNode[] {
    const parents = [];
    let node = this.parent;
    while (node) {
      parents.push(node);
      node = node.parent;
    }
    return parents;
  }

  // 获取兄弟节点，包含自己在内
  public getSiblings(): TreeNode[] {
    const { parent, tree } = this;
    let list = [];
    if (parent) {
      if (Array.isArray(parent.children)) {
        list = parent.children;
      }
    } else if (tree) {
      list = tree.children;
    }
    return list;
  }

  // 获取根节点
  public getRoot(): TreeNode {
    const parents = this.getParents();
    return parents[parents.length - 1] || null;
  }

  // 获取节点在父节点的子节点列表中的位置
  // 如果没有父节点，则获取节点在根节点列表的位置
  public getIndex(): number {
    const list = this.getSiblings();
    return list.indexOf(this);
  }

  // 返回路径节点
  public getPath(): TreeNode[] {
    const nodes = this.getParents();
    nodes.unshift(this);
    return nodes.reverse();
  }

  // 获取节点所在层级
  public getLevel(): number {
    const parents = this.getParents();
    return parents.length;
  }

  // 判断节点是否可视
  public getVisible(): boolean {
    const {
      nodeMap,
      config,
      filterMap,
    } = this.tree;
    let visible = true;
    if (nodeMap.get(this.value)) {
      const parents = this.getParents();
      let expandVisible = true;
      if (parents.length > 0) {
        expandVisible = parents.every((node: TreeNode) => node.isExpanded());
      }
      let filterVisible = false;
      if (typeof config.filter === 'function') {
        const nodeModel = this.getTreeNodeModel();
        filterVisible = config.filter(nodeModel);
        if (filterVisible) {
          filterMap.set(this.value, true);
        } else {
          if (filterMap.get(this.value)) {
            filterMap.delete(this.value);
          }
        }
        // 更新经过过滤的节点状态
        this.tree.updateFilterNodes();
      }

      // 父节点展开 或 满足过滤条件，均显示当前节点
      visible = expandVisible || filterVisible;
    } else {
      visible = false;
    }
    return visible;
  }

  /* ***** 节点状态判断-相关方法 ***** */
  // 判断节点是否被禁用
  public isDisabled() {
    return this?.tree?.config?.disabled || this.disabled;
  }

  // 判断节点是否支持互斥展开
  public isExpandMutex() {
    return this?.tree?.config?.expandMutex || this.expandMutex;
  }

  // 节点可高亮
  public isActivable() {
    return this?.tree?.config?.activable || this.activable;
  }

  // 是否可选
  public isCheckable() {
    return this?.tree?.config?.checkable || this.checkable;
  }

  // 检查节点是否被激活
  public isActived(map?: Map<string, boolean>): boolean {
    const { tree, value } = this;
    const activedMap = map || tree.activedMap;
    return !!(tree.nodeMap.get(value) && activedMap.get(value));
  }

  // 检查节点是否已展开
  public isExpanded(map?: Map<string, boolean>): boolean {
    const { tree, value } = this;
    const expandedMap = map || tree.expandedMap;
    return !!(tree.nodeMap.get(value) && expandedMap.get(value));
  }

  // 计算属性，判断节点是否被选中
  // map: 预期选中项map，用于计算节点在预期环境中的选中态
  public isChecked(map?: TypeIdMap): boolean {
    const { children, tree } = this;
    const { checkStrictly } = tree.config;
    let checked = false;
    const checkedMap = map || tree.checkedMap;
    if (tree.nodeMap.get(this.value)) {
      if (checkedMap.get(this.value)) {
        // 如果在 checked 节点列表中，则直接为 true
        checked = true;
      } else if (
        Array.isArray(children)
        && children.length > 0
        && !checkStrictly
      ) {
        // 如果是父节点，需检查所有子节点状态
        checked = children.every((node) => {
          const childIsChecked = node.isChecked(checkedMap);
          return childIsChecked;
        });
      } else if (!checkStrictly) {
        // 从父节点状态推断子节点状态
        // 这里再调用 isChecked 会导致死循环
        const parents = this.getParents();
        checked = parents.some(node => checkedMap.get(node.value));
      }
    }
    return !!checked;
  }

  // 是否为半选状态
  public isIndeterminate(): boolean {
    const { children } = this;
    let indeterminate = false;
    if (Array.isArray(children)) {
      // 叶节点不存在半选状态
      let childChecked: null | boolean = null;
      indeterminate = children.some((node: TreeNode) => {
        if (node.isIndeterminate()) {
          // 子节点有任意一个半选，则其为半选状态
          return true;
        }
        if (childChecked === null) {
          childChecked = node.isChecked();
        }
        if (childChecked !== node.isChecked()) {
          // 子节点选中状态不一致，则其为半选状态
          return true;
        }
        return false;
      });
    }
    return indeterminate;
  }

  public isFirst(): boolean {
    const siblings = this.getSiblings();
    return siblings[0] === this;
  }

  public isLast(): boolean {
    const siblings = this.getSiblings();
    return siblings[siblings.length - 1] === this;
  }

  // 是叶节点
  public isLeaf(): boolean {
    let isLeaf = false;
    if (Array.isArray(this.children)) {
      isLeaf = this.children.length <= 0;
    } else {
      isLeaf = !this.children;
    }
    return isLeaf;
  }

  /* ***** 节点状态切换-相关方法 ***** */
  // 节点展开关闭后需要调用的状态检查函数
  public afterExpanded(): void {
    this.update();
    // 节点展开时检查延迟加载的数据
    if (this.expanded && this.children === true) {
      this.loadChildren();
    }
  }

  // 展开或者关闭节点
  public toggleExpanded(): TreeNodeValue[] {
    return this.setExpanded(!this.isExpanded());
  }

  // 设置节点展开状态
  public setExpanded(expanded: boolean, opts?: TypeSettingOptions): TreeNodeValue[] {
    const { tree } = this;
    const options = {
      directly: false,
      ...opts,
    };

    let map = tree.expandedMap;
    if (!options.directly) {
      map = new Map(tree.expandedMap);
    }

    // 手风琴效果，先折叠同级节点
    if (expanded) {
      const shouldExpandNodes = [];
      shouldExpandNodes.push(this);
      if (tree?.config?.expandParent) {
        this.getParents().forEach((node) => {
          shouldExpandNodes.push(node);
        });
      }
      shouldExpandNodes.forEach((node) => {
        let isExpandMutex = false;
        if (node.parent) {
          isExpandMutex = node.parent.isExpandMutex();
        } else {
          isExpandMutex = tree?.config?.expandMutex;
        }
        if (isExpandMutex) {
          const siblings = node.getSiblings();
          siblings.forEach((snode) => {
            map.delete(snode.value);
          });
        }
        map.set(node.value, true);
      });
    } else {
      map.delete(this.value);
    }

    if (options.directly) {
      this.afterExpanded();
      this.update();
      this.updateChildren();
    }

    return tree.getExpanded(map);
  }

  // 切换节点激活态
  public toggleActived(): TreeNodeValue[] {
    return this.setActived(!this.isActived());
  }

  // 设置节点激活态
  public setActived(actived: boolean, opts?: TypeSettingOptions): TreeNodeValue[] {
    const { tree } = this;
    const options = {
      directly: false,
      ...opts,
    };
    const config = tree.config || {};
    let map = tree.activedMap;
    if (!options.directly) {
      map = new Map(tree.activedMap);
    }
    if (this.isActivable()) {
      if (actived) {
        if (!config.activeMultiple) {
          map.clear();
        }
        map.set(this.value, true);
      } else {
        map.delete(this.value);
      }
    }
    if (options.directly) {
      this.update();
    }
    return tree.getActived(map);
  }

  // 切换选中态
  public toggleChecked(): TreeNodeValue[] {
    return this.setChecked(!this.isChecked());
  }

  // 更新单个节点的选中态
  // 返回树选中列表
  public setChecked(checked: boolean, opts?: TypeSettingOptions): TreeNodeValue[] {
    const { tree } = this;
    const config = tree.config || {};
    const options = {
      directly: false,
      ...opts,
    };
    let map = tree.checkedMap;
    if (!options.directly) {
      map = new Map(tree.checkedMap);
    }
    if (this.isCheckable() && checked !== this.isChecked()) {
      if (config.checkStrictly) {
        if (checked) {
          map.set(this.value, true);
        } else {
          map.delete(this.value);
        }
      } else {
        const children = this.walk();
        // 子节点的预期选中态与当前节点同步
        children.forEach((node) => {
          if (checked) {
            map.set(node.value, true);
          } else {
            map.delete(node.value);
          }
        });
        // 消除全部父节点的预期选中态
        // 父节点的预期选中态将通过计算得出
        const parents = this.getParents();
        parents.forEach((node) => {
          map.delete(node.value);
        });
      }
    }
    if (options.directly) {
      if (config.checkStrictly) {
        this.updateChecked();
      } else {
        const relatedNodes = tree.getRelatedNodes([this.value]);
        relatedNodes.forEach((node) => {
          node.updateChecked();
        });
      }
    }
    return tree.getChecked(map);
  }

  /* ***** 节点状态更新-相关方法 ***** */
  // 更新节点状态
  public update(): void {
    this.vmIsFirst = this.isFirst();
    this.vmIsLast = this.isLast();
    this.vmIsLeaf = this.isLeaf();
    this.level = this.getLevel();
    this.actived = this.isActived();
    this.expanded = this.isExpanded();
    this.visible = this.getVisible();
    this.tree.updated(this);
  }

  // 更新选中态属性值
  public updateChecked(): void {
    const { tree } = this;
    this.vmCheckable = this.isCheckable();
    if (this.vmCheckable) {
      this.checked = this.isChecked();
      if (this.checked) {
        tree.checkedMap.set(this.value, true);
      }
      this.indeterminate = this.isIndeterminate();
      tree.updated(this);
    }
  }

  // 更新所有子节点状态
  // 注意:不包含自己
  public updateChildren(): void {
    const { children } = this;
    if (Array.isArray(children)) {
      children.forEach((node) => {
        node.update();
        node.updateChecked();
        node.updateChildren();
      });
    }
  }

  // 父节点状态更新
  // 注意:不包含自己
  public updateParents(): void {
    const { parent } = this;
    if (parent) {
      parent.update();
      parent.updateChecked();
      parent.updateParents();
    }
  }

  // 更新上下游相关节点
  public updateRelated() {
    const { tree } = this;
    const relatedNodes = tree.getRelatedNodes([this.value]);
    relatedNodes.forEach((node) => {
      node.update();
      node.updateChecked();
    });

    tree.reflow();
  }

  /* ***** 节点基础操作-获取包含自己在内所有的子节点 ***** */
  // 获取包含自己在内所有的子节点
  public walk(): TreeNode[] {
    const { children } = this;
    let list: TreeNode[] = [];
    list.push(this);
    if (Array.isArray(children) && children.length > 0) {
      children.forEach((node) => {
        list = list.concat(node.walk());
      });
    }
    return list;
  }

  // TreeNode 对象 => TypeTreeNodeModel 对象
  public getTreeNodeModel(): TypeTreeNodeModel {
    const {
      dataset,
      actived,
      expanded,
      checked,
      indeterminate,
      loading,
      getPathData,
      append,
      getIndex,
      getLevel,
      getParentData,
      getParentsData,
      getRootData,
      getSiblingsData,
      insertBefore,
      insertAfter,
      isFirst,
      isLast,
      isLeaf,
    } = this;
    const nodeModel: TypeTreeNodeModel = {
      data: dataset,
      actived,
      expanded,
      checked,
      indeterminate,
      loading,
      getPathData,
      appendData: append,
      getIndex,
      getLevel,
      getParentData,
      getParentsData,
      getRootData,
      getSiblingsData,
      insertBefore,
      insertAfter,
      isFirst,
      isLast,
      isLeaf,
    };
    return nodeModel;
  }

  /* ***** 对外暴露方法 ***** */
  // 返回路径节点数据集合
  public getPathData = (): TypeTreeNodeData[] => {
    const nodes = this.getPath();
    return nodes.map(node => node.dataset);
  };

  // 获取单个父节点数据
  public getParentData = (): TypeTreeNodeData => (this.parent?.dataset);

  // 获取所有父节点数据
  public getParentsData = (): TypeTreeNodeData[] => {
    const nodes = this.getParents();
    return nodes.map(node => node.dataset);
  };

  // 获取根节点
  public getRootData = (): TypeTreeNodeData => {
    const root = this.getRoot();
    return root?.dataset;
  };

  // 获取兄弟节点，包含自己在内
  public getSiblingsData = (): TypeTreeNodeData[] => {
    const nodes = this.getSiblings();
    return nodes.map(node => node.dataset);
  };
}

export default TreeNode;
