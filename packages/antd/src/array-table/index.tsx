import React, {
  Fragment,
  useState,
  useRef,
  useEffect,
  createContext,
  useContext,
  useCallback,
} from 'react'
import { Table, Pagination, Space, Select, Badge } from 'antd'
import { PaginationProps } from 'antd/lib/pagination'
import { TableProps, ColumnProps } from 'antd/lib/table'
import { SelectProps } from 'antd/lib/select'
import cls from 'classnames'
import { SortableContainer, SortableElement } from 'react-sortable-hoc'
import { GeneralField, FieldDisplayTypes, ArrayField } from '@formily/core'
import {
  useField,
  observer,
  useFieldSchema,
  RecursionField,
  ReactFC,
} from '@formily/react'
import { isArr, isBool, isFn } from '@formily/shared'
import { Schema } from '@formily/json-schema'
import { usePrefixCls } from '../__builtins__'
import { ArrayBase, ArrayBaseMixins } from '../array-base'

interface ObservableColumnSource {
  field: GeneralField
  columnProps: ColumnProps<any>
  schema: Schema
  display: FieldDisplayTypes
  name: string
}
interface IArrayTablePaginationProps extends PaginationProps {
  dataSource?: any[]
  children?: (
    dataSource: any[],
    pagination: React.ReactNode
  ) => React.ReactElement
}

interface IStatusSelectProps extends SelectProps<any> {
  pageSize?: number
}

type ComposedArrayTable = React.FC<React.PropsWithChildren<TableProps<any>>> &
  ArrayBaseMixins & {
    Column?: React.FC<React.PropsWithChildren<ColumnProps<any>>>
  }

interface PaginationAction {
  totalPage?: number
  pageSize?: number
  changePage?: (page: number) => void
}

const SortableRow = SortableElement((props: any) => <tr {...props} />)
const SortableBody = SortableContainer((props: any) => <tbody {...props} />)

const isColumnComponent = (schema: Schema) => {
  return schema['x-component']?.indexOf('Column') > -1
}

const isOperationsComponent = (schema: Schema) => {
  return schema['x-component']?.indexOf('Operations') > -1
}

const isAdditionComponent = (schema: Schema) => {
  return schema['x-component']?.indexOf('Addition') > -1
}

const useArrayTableSources = () => {
  const arrayField = useField()
  const schema = useFieldSchema()
  const parseSources = (schema: Schema): ObservableColumnSource[] => {
    if (
      isColumnComponent(schema) ||
      isOperationsComponent(schema) ||
      isAdditionComponent(schema)
    ) {
      if (!schema['x-component-props']?.['dataIndex'] && !schema['name'])
        return []
      const name = schema['x-component-props']?.['dataIndex'] || schema['name']
      const field = arrayField.query(arrayField.address.concat(name)).take()
      const columnProps =
        field?.component?.[1] || schema['x-component-props'] || {}
      const display = field?.display || schema['x-display'] || 'visible'
      return [
        {
          name,
          display,
          field,
          schema,
          columnProps,
        },
      ]
    } else if (schema.properties) {
      return schema.reduceProperties((buf, schema) => {
        return buf.concat(parseSources(schema))
      }, [])
    }
  }

  const parseArrayItems = (schema: Schema['items']) => {
    if (!schema) return []
    const sources: ObservableColumnSource[] = []
    const items = isArr(schema) ? schema : [schema]
    return items.reduce((columns, schema) => {
      const item = parseSources(schema)
      if (item) {
        return columns.concat(item)
      }
      return columns
    }, sources)
  }

  if (!schema) throw new Error('can not found schema object')

  return parseArrayItems(schema.items)
}

const useArrayTableColumns = (
  dataSource: any[],
  field: ArrayField,
  sources: ObservableColumnSource[]
): TableProps<any>['columns'] => {
  return sources.reduce((buf, { name, columnProps, schema, display }, key) => {
    if (display !== 'visible') return buf
    if (!isColumnComponent(schema)) return buf
    return buf.concat({
      ...columnProps,
      key,
      dataIndex: name,
      render: (value: any, record: any) => {
        const index = dataSource?.indexOf(record)
        const children = (
          <ArrayBase.Item index={index} record={() => field?.value?.[index]}>
            <RecursionField schema={schema} name={index} onlyRenderProperties />
          </ArrayBase.Item>
        )
        return children
      },
    })
  }, [])
}

const useAddition = () => {
  const schema = useFieldSchema()
  return schema.reduceProperties((addition, schema, key) => {
    if (isAdditionComponent(schema)) {
      return <RecursionField schema={schema} name={key} />
    }
    return addition
  }, null)
}

const schedulerRequest = {
  request: null,
}

const StatusSelect: ReactFC<IStatusSelectProps> = observer(
  (props) => {
    const field = useField<ArrayField>()
    const prefixCls = usePrefixCls('formily-array-table')
    const errors = field.errors
    const parseIndex = (address: string) => {
      return Number(
        address
          .slice(address.indexOf(field.address.toString()) + 1)
          .match(/(\d+)/)?.[1]
      )
    }
    const options = props.options?.map(({ label, value }) => {
      const val = Number(value)
      const hasError = errors.some(({ address }) => {
        const currentIndex = parseIndex(address)
        const startIndex = (val - 1) * props.pageSize
        const endIndex = val * props.pageSize
        return currentIndex >= startIndex && currentIndex <= endIndex
      })
      return {
        label: hasError ? <Badge dot>{label}</Badge> : label,
        value,
      }
    })

    const width = String(options?.length).length * 15

    return (
      <Select
        value={props.value}
        onChange={props.onChange}
        options={options}
        virtual
        style={{
          width: width < 60 ? 60 : width,
        }}
        className={cls(`${prefixCls}-status-select`, {
          'has-error': errors?.length,
        })}
      />
    )
  },
  {
    scheduler: (update) => {
      clearTimeout(schedulerRequest.request)
      schedulerRequest.request = setTimeout(() => {
        update()
      }, 100)
    },
  }
)

const PaginationContext = createContext<PaginationAction>({})
const usePagination = () => {
  return useContext(PaginationContext)
}

const ArrayTablePagination: ReactFC<IArrayTablePaginationProps> = (props) => {
  const [current, setCurrent] = useState(1)
  const prefixCls = usePrefixCls('formily-array-table')
  const pageSize = props.pageSize || 10
  const size = props.size || 'default'
  const dataSource = props.dataSource || []
  const startIndex = (current - 1) * pageSize
  const endIndex = startIndex + pageSize - 1
  const total = dataSource?.length || 0
  const totalPage = Math.ceil(total / pageSize)
  const pages = Array.from(new Array(totalPage)).map((_, index) => {
    const page = index + 1
    return {
      label: page,
      value: page,
    }
  })
  const handleChange = (current: number) => {
    setCurrent(current)
  }

  useEffect(() => {
    if (totalPage > 0 && totalPage < current) {
      handleChange(totalPage)
    }
  }, [totalPage, current])

  const renderPagination = () => {
    if (totalPage <= 1) return
    return (
      <div className={`${prefixCls}-pagination`}>
        <Space>
          <StatusSelect
            value={current}
            pageSize={pageSize}
            onChange={handleChange}
            options={pages}
            notFoundContent={false}
          />
          <Pagination
            {...props}
            pageSize={pageSize}
            current={current}
            total={dataSource.length}
            size={size}
            showSizeChanger={false}
            onChange={handleChange}
          />
        </Space>
      </div>
    )
  }

  return (
    <Fragment>
      <PaginationContext.Provider
        value={{ totalPage, pageSize, changePage: handleChange }}
      >
        {props.children?.(
          dataSource?.slice(startIndex, endIndex + 1),
          renderPagination()
        )}
      </PaginationContext.Provider>
    </Fragment>
  )
}

const RowComp = (props: any) => {
  return <SortableRow index={props['data-row-key'] || 0} {...props} />
}

export const ArrayTable: ComposedArrayTable = observer(
  (props: TableProps<any>) => {
    const ref = useRef<HTMLDivElement>()
    const field = useField<ArrayField>()
    const prefixCls = usePrefixCls('formily-array-table')
    const dataSource = Array.isArray(field.value) ? field.value.slice() : []
    const sources = useArrayTableSources()
    const columns = useArrayTableColumns(dataSource, field, sources)
    const pagination = isBool(props.pagination) ? {} : props.pagination
    const addition = useAddition()
    const defaultRowKey = (record: any) => {
      return dataSource.indexOf(record)
    }
    const addTdStyles = (node: HTMLElement) => {
      const helper = document.body.querySelector(`.${prefixCls}-sort-helper`)
      if (helper) {
        const tds = node.querySelectorAll('td')
        requestAnimationFrame(() => {
          helper.querySelectorAll('td').forEach((td, index) => {
            if (tds[index]) {
              td.style.width = getComputedStyle(tds[index]).width
            }
          })
        })
      }
    }
    const WrapperComp = useCallback(
      (props: any) => (
        <SortableBody
          useDragHandle
          lockAxis="y"
          helperClass={`${prefixCls}-sort-helper`}
          helperContainer={() => {
            return ref.current?.querySelector('tbody')
          }}
          onSortStart={({ node }) => {
            addTdStyles(node as HTMLElement)
          }}
          onSortEnd={({ oldIndex, newIndex }) => {
            field.move(oldIndex, newIndex)
          }}
          {...props}
        />
      ),
      [field]
    )
    return (
      <ArrayTablePagination {...pagination} dataSource={dataSource}>
        {(dataSource, pager) => (
          <div ref={ref} className={prefixCls}>
            <ArrayBase>
              <Table
                size="small"
                bordered
                rowKey={defaultRowKey}
                {...props}
                onChange={() => {}}
                pagination={false}
                columns={columns}
                dataSource={dataSource}
                components={{
                  body: {
                    wrapper: WrapperComp,
                    row: RowComp,
                  },
                }}
              />
              <div style={{ marginTop: 5, marginBottom: 5 }}>{pager}</div>
              {sources.map((column, key) => {
                //专门用来承接对Column的状态管理
                if (!isColumnComponent(column.schema)) return
                return React.createElement(RecursionField, {
                  name: column.name,
                  schema: column.schema,
                  onlyRenderSelf: true,
                  key,
                })
              })}
              {addition}
            </ArrayBase>
          </div>
        )}
      </ArrayTablePagination>
    )
  }
)

ArrayTable.displayName = 'ArrayTable'

ArrayTable.Column = () => {
  return <Fragment />
}

ArrayBase.mixin(ArrayTable)

const Addition: ArrayBaseMixins['Addition'] = (props) => {
  const array = ArrayBase.useArray()
  const { totalPage = 0, pageSize = 10, changePage } = usePagination()
  return (
    <ArrayBase.Addition
      {...props}
      onClick={(e) => {
        // 如果添加数据后将超过当前页，则自动切换到下一页
        const total = array?.field?.value.length || 0
        if (total === totalPage * pageSize + 1 && isFn(changePage)) {
          changePage(totalPage + 1)
        }
        props.onClick?.(e)
      }}
    />
  )
}
ArrayTable.Addition = Addition

export default ArrayTable
